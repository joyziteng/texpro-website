<?php
/**
 * TEXPRO 询盘表单后端（站点根：/var/www/texpro/inquiry.php）
 *
 * - 仅接受 POST；方法不对返回 405 + {ok:false,errors:{method:...}}
 * - 任何校验失败返回 HTTP 200 + {ok:false,errors:{字段:原因}}（前端按码映射文案）
 * - 校验通过后把 JSON 行追加写入 /var/www/texpro-data/inquiries/inquiries.jsonl
 * - 写入成功才返回 {ok:true}；随后 best-effort mail() 通知销售（失败不影响 ok，但记日志）
 * - 按 IP 文件限频：/var/www/texpro-data/ratelimit/，每 IP 每小时 ≤ 5 次（原子计数，超限 429）
 * - 蜜罐字段 website 非空 → 静默返回 {ok:true} 并丢弃（不写盘、不发信）
 * - 同源校验：Origin/Referer 存在时必须与当前 Host 同域（www 与裸域视为同源）
 * - 本脚本绝不外发任何 HTTP 请求；数据目录可用环境变量 TEXPRO_DATA_DIR 覆盖（仅测试用）
 * - 数据留存：inquiries.jsonl 含个人信息，默认不轮转；留存期限与清理责任见 README.md
 */

declare(strict_types=1);

error_reporting(0); // 不向客户端泄露警告/路径

function inquiry_data_dir(): string
{
    $env = getenv('TEXPRO_DATA_DIR');
    return ($env !== false && $env !== '') ? $env : '/var/www/texpro-data';
}

function inquiry_respond(array $payload): void
{
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function inquiry_fail(array $errors): void
{
    inquiry_respond(array('ok' => false, 'errors' => $errors));
}

function inquiry_len(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

/**
 * 同源校验：有 Origin 时只认 Origin；无 Origin 时看 Referer；两者都无则放行
 * （本接口无凭据、无状态变更，缺失来源头多为 curl/隐私浏览器，风险可接受）。
 * www 与裸域视为同源，避免双域名部署时误伤。
 */
function inquiry_same_origin(): bool
{
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
    $source = $origin !== '' ? $origin : $referer;
    if ($source === '') {
        return true;
    }
    $h = parse_url($source, PHP_URL_HOST);
    if (!is_string($h) || $h === '') {
        return false;
    }
    $h = strtolower($h);
    return $h === $host || 'www.' . $h === $host || $h === 'www.' . $host;
}

/**
 * 服务端校验。原因用稳定英文短码（required / invalid email / too long），
 * 由前端按页面语言映射为中文/英文提示。
 * @return array<string,string> 字段 => 原因
 */
function inquiry_validate(array $in): array
{
    $errors = array();

    // 必填：name / email / message；选填：company / category
    $fields = array(
        'name'    => array('req' => true,  'max' => 200),
        'email'   => array('req' => true,  'max' => 200),
        'company' => array('req' => false, 'max' => 200),
        'category'=> array('req' => false, 'max' => 200),
        'message' => array('req' => true,  'max' => 5000),
    );

    $clean = array();
    foreach ($fields as $f => $rule) {
        $v = isset($in[$f]) && is_string($in[$f]) ? trim($in[$f]) : '';
        $clean[$f] = $v;
        if ($v === '') {
            if ($rule['req']) {
                $errors[$f] = 'required';
            }
            continue;
        }
        if (inquiry_len($v) > $rule['max']) {
            $errors[$f] = 'too long';
        }
    }

    if (!isset($errors['email']) && $clean['email'] !== ''
        && !filter_var($clean['email'], FILTER_VALIDATE_EMAIL)) {
        $errors['email'] = 'invalid email';
    }

    return $errors;
}

/**
 * 原子限频：同一把 flock 内完成「读→裁剪窗口→判上限→追加→写回」。
 * 返回 true=允许本次（并已计数）；false=超限或存储不可用（保守拒绝）。
 * 在「校验通过后」调用，正常用户填错字段不占配额。
 */
function inquiry_rate_consume(string $ip, int $limit = 5, int $window = 3600): bool
{
    $dir = inquiry_data_dir() . '/ratelimit';
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
        return false; // 目录不可用则保守拒绝
    }
    $file = $dir . '/' . hash('sha256', 'texpro-rl-' . $ip) . '.json';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        return false;
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return false;
    }
    $now = time();
    $raw = stream_get_contents($fp);
    $hits = array();
    $decoded = ($raw === false || $raw === '') ? null : json_decode($raw, true);
    if (is_array($decoded)) {
        foreach ($decoded as $ts) {
            if (is_int($ts) && $ts > $now - $window) {
                $hits[] = $ts;
            }
        }
    }
    if (count($hits) >= $limit) {
        flock($fp, LOCK_UN);
        fclose($fp);
        return false;
    }
    $hits[] = $now;
    $payload = json_encode($hits);
    if ($payload === false) {
        flock($fp, LOCK_UN);
        fclose($fp);
        return false;
    }
    ftruncate($fp, 0);
    rewind($fp);
    $ok = fwrite($fp, $payload);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    @chmod($file, 0640);
    return $ok !== false;
}

/* ---------------- 主流程 ---------------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    if (!headers_sent()) {
        http_response_code(405);
        header('Allow: POST');
    }
    inquiry_fail(array('method' => 'POST required'));
}

if (!inquiry_same_origin()) {
    if (!headers_sent()) {
        http_response_code(403);
    }
    inquiry_fail(array('origin' => 'forbidden'));
}

$in = $_POST;

// 蜜罐：正常用户不会填 website；非空即判定为机器人，静默成功丢弃
$honeypot = isset($in['website']) && is_string($in['website']) && trim($in['website']) !== '';
if ($honeypot) {
    inquiry_respond(array('ok' => true));
}

$errors = inquiry_validate($in);
if ($errors) {
    inquiry_fail($errors);
}

$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
$ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);

if (!inquiry_rate_consume($ip)) {
    if (!headers_sent()) {
        http_response_code(429);
        header('Retry-After: 3600');
    }
    inquiry_fail(array('rate' => 'too many requests'));
}

$record = array(
    'time'     => date('c'),
    'name'     => trim((string)$in['name']),
    'email'    => trim((string)$in['email']),
    'company'  => trim((string)($in['company'] ?? '')),
    'category' => trim((string)($in['category'] ?? '')),
    'message'  => trim((string)$in['message']),
    'ip'       => $ip,
    'ua'       => $ua,
);

$dir = inquiry_data_dir() . '/inquiries';
if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
    inquiry_fail(array('server' => 'storage error'));
}

$line = json_encode($record, JSON_UNESCAPED_UNICODE);
if ($line === false) {
    // 非法 UTF-8 等编码失败：不能把空行写进数据文件后还报成功
    inquiry_fail(array('server' => 'encoding error'));
}
$line .= "\n";
$written = @file_put_contents($dir . '/inquiries.jsonl', $line, FILE_APPEND | LOCK_EX);
if ($written === false || $written < strlen($line)) {
    inquiry_fail(array('server' => 'storage error'));
}

/* 邮件通知：best-effort，失败不影响 ok，但写一行日志便于排查 */
$to = 'sandy@texpro.com.cn, mike@texpro.com.cn';
$subject = 'New website inquiry (' . date('Y-m-d H:i') . ')';
$body = "New website inquiry\n"
      . str_repeat('-', 36) . "\n"
      . 'Time:     ' . $record['time'] . "\n"
      . 'Name:     ' . $record['name'] . "\n"
      . 'Email:    ' . $record['email'] . "\n"
      . 'Company:  ' . $record['company'] . "\n"
      . 'Category: ' . $record['category'] . "\n"
      . 'Message:  ' . $record['message'] . "\n"
      . 'IP:       ' . $record['ip'] . "\n";
$headers = 'From: TEXPRO Website <noreply@texpro.com.cn>' . "\r\n"
         . 'Reply-To: ' . $record['email'] . "\r\n"
         . 'X-Mailer: PHP/' . phpversion();
$mailed = @mail($to, $subject, $body, $headers);
if (!$mailed) {
    @file_put_contents(
        inquiry_data_dir() . '/mail-errors.log',
        date('c') . " mail() failed for inquiry at " . $record['time'] . "\n",
        FILE_APPEND | LOCK_EX
    );
}

inquiry_respond(array('ok' => true));
