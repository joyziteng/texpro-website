# TEXPRO Website

TEXPRO（南京舜特斯普家居用品有限公司）中英文官网源码。本仓库为**公开仓库**，用途是把同一套站点部署到任意自管服务器。

- 站点类型：静态 HTML/CSS/JS（无构建、无数据库、无 CI）+ 1 个 PHP 询盘接口
- 参考线上站：<https://www.texpro.com.cn/>（部署形态示例，不是本仓库的运行依赖）
- 备案号：苏ICP备2026055433号-2（写在各页页脚，迁移到其他主体/域名时按需修改）
- 当前资源版本：`?v=20261113c`

> 仓库中包含 `inquiry.php`（询盘后端）与 `tools/`（校验、部署脚本、nginx 模板）。它们是站点功能与部署所必需的，随静态文件一同公开；`tools/` 不会被部署到站点根目录。

---

## 一、仓库内容

| 路径 | 说明 |
|---|---|
| `*.html` | 18 个页面：中英成对 7 对 + 首页 `cn.html`/`en.html` + `index.html` 门户 + `404.html` |
| `assets/css/style.css` | 全站样式 |
| `assets/js/main.js` | 导航、轮播、产品分类、表单提交 |
| `assets/scroll/` | 首页整屏翻页（`page-transition.css` + `fullpage-scroll.js`） |
| `assets/img\|media\|products\|images/` | 图片与视频，约 91 MiB |
| `inquiry.php` | 唯一后端接口：校验询盘 → 追加写 JSONL → best-effort 邮件通知 |
| `favicon.ico` | 站点图标（多尺寸 ico，18 个页面统一引用） |
| `robots.txt`、`sitemap.xml` | SEO 静态文件 |
| `tools/check.py` | 只读静态校验（纯标准库） |
| `tools/deploy.sh` | 部署脚本（人工触发） |
| `tools/texpro.conf` | nginx 站点配置模板 |
| `tools/texpro-security-headers.conf` | nginx 安全响应头片段（被 `texpro.conf` include） |

`.gitignore` 排除：运行时询盘数据、旧上传目录、ACME 挑战文件、`*.bak*`、`.DS_Store`。这些文件从未进入 git 历史。

---

## 二、目标服务器环境要求

| 组件 | 要求 | 说明 |
|---|---|---|
| nginx | 1.20+（实测 1.26.1） | 需支持 `add_header ... always`、`error_page`、`location =`、`include`、`http2` |
| PHP | 7.4+（实测 7.4.33） | 仅 `inquiry.php` 使用；`declare(strict_types=1)`、无第三方扩展硬依赖（`mb_strlen` 可选） |
| PHP-FPM | 监听 `127.0.0.1:9000` | 按实际改 `tools/texpro.conf` 的 `fastcgi_pass` |
| MTA | `sendmail`（`/usr/sbin/sendmail -t -i`）或等价 `mail()` 通道 | 邮件通知为 best-effort，失败写日志但不影响询盘落盘 |
| SSL 证书 | SAN 覆盖实际使用的域名（含裸域与 www） | **证书与私钥不在仓库**，需自行准备 |
| 运行时数据目录 | `/var/www/texpro-data/` | 属主 `nginx:nginx`、权限 `0750`；内含 `inquiries/`、`ratelimit/`；**含个人信息，禁止入仓** |
| 磁盘 | ≥ 200 MB | `assets/` 约 91 MiB |
| 部署机工具 | `rsync`、`python3`（校验）、`node`（可选，JS 语法检查） | 仅运维机需要，服务器运行时不需要 |

**不需要**：Node 构建链、composer、数据库、Redis、对象存储、CDN、CI 服务、容器。
站点文件按原样放置即可，没有编译、打包、环境变量注入步骤。

### 运行时行为
- `inquiry.php` 仅接受 POST（nginx 层 405，后端亦返回 405）；校验失败返回 200 + 字段错误码；限频超限 429；跨站 Origin 403。
- 数据目录可用环境变量 `TEXPRO_DATA_DIR` 覆盖（便于测试）。默认 `/var/www/texpro-data`。
- 写入内容：`inquiries/inquiries.jsonl`（`time/name/email/company/category/message/ip/ua`）、`ratelimit/*.json`、`mail-errors.log`。
- 限频：每 IP 每小时 5 次，`flock` 原子计数。
- 静态资源带 `?v=` 长缓存，HTML `no-cache`；改静态资源后必须全站 bump 版本号（见第五节）。

---

## 三、首次部署到新服务器（照此顺序执行）

1. **取代码并校验**
   ```bash
   git clone https://github.com/joyziteng/texpro-website.git
   cd texpro-website
   python3 -I tools/check.py          # 必须 0 错误 0 警告
   node --check assets/js/main.js
   node --check assets/scroll/fullpage-scroll.js
   ```

2. **按目标环境改配置**（详见第四节「需替换项」）
   - 复制 `tools/texpro.conf` → `/etc/nginx/conf.d/texpro.conf`
   - 复制 `tools/texpro-security-headers.conf` → `/etc/nginx/snippets/texpro-security-headers.conf`
   - 修改域名、`root`、证书路径、`fastcgi_pass`、301 目标。

3. **建运行时目录**（不要放进站点根目录，不要提交）
   ```bash
   mkdir -p /var/www/texpro-data/{inquiries,ratelimit}
   chown -R nginx:nginx /var/www/texpro-data
   chmod 0750 /var/www/texpro-data /var/www/texpro-data/{inquiries,ratelimit}
   ```

4. **检查 PHP 语法**（把文件传到服务器 /tmp 后执行，随后删除）
   ```bash
   php -l /tmp/inquiry.php
   ```

5. **同步站点文件**（`tools/` 不进站点根目录）

   > `favicon.ico` 常来自下载附件，可能带 `600` 权限；`rsync` 会保留权限，传到服务器后 nginx 读不到会返回 403。`tools/deploy.sh` 已在同步前统一 `chmod 644`；若手工 rsync，需先确认 `favicon.ico` 为 `644` 且 nginx 用户可读。

   ```bash
   tools/deploy.sh user@host:/var/www/texpro/ --dry-run   # 先看增删清单
   tools/deploy.sh user@host:/var/www/texpro/ https://your-domain.example/
   ```
   `rsync --delete` 会删除目标端多余文件，首次务必先 `--dry-run`。

6. **生效并校验**
   ```bash
   nginx -t && systemctl reload nginx
   ```
   `nginx -t` 失败时用备份配置回滚，不要带着错误配置 reload。

7. **部署后校验清单**

   | 项 | 期望 |
   |---|---|
   | `/`、`/cn.html` | 200，含 HSTS / CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy；`Cache-Control: no-cache` |
   | `/robots.txt`、`/sitemap.xml` | 200 |
   | `/404.html`、任意不存在路径 | 404 |
   | `http://`、裸域 | 301 → `https://<主域>/` |
   | `GET /inquiry.php` | 405 |
   | `POST /inquiry.php` 空数据 | 200 + `{"ok":false,"errors":...}`（不写盘、不发信） |
   | `POST /inquiry.php` 带外域 Origin | 403 + `{"errors":{"origin":"forbidden"}}` |
   | 页面 `?v=` | 与仓库一致 |
   | 浏览器首页 | 开屏淡出、轮播切换不发黑、翻页面板可切换；窄屏为自然滚动 |

---

## 四、配置模板需替换项

`tools/texpro.conf` 中的现网值仅作示例，部署到别处必须替换：

| 项 | 模板中的值 | 改成 |
|---|---|---|
| `server_name`（3 处 server 块） | `texpro.com.cn` / `www.texpro.com.cn` | 目标域名 |
| `root` | `/var/www/texpro` | 目标站点根目录 |
| `ssl_certificate` / `ssl_certificate_key` | `/etc/nginx/ssl/texpro/fullchain.pem` / `key.pem` | 目标证书路径 |
| `fastcgi_pass` | `127.0.0.1:9000` | 目标 PHP-FPM 地址 |
| `return 301`（HTTP 与裸域 HTTPS 块） | `https://www.texpro.com.cn$request_uri` | 目标主域 |
| `access_log` / `error_log` | `/var/log/nginx/texpro.*.log` | 按需 |

同时需要按目标域名改页面里的绝对 URL（全站 18 页 + 2 个 SEO 文件）：

| 文件 | 字段 |
|---|---|
| `*.html` | `rel="canonical"`、`hreflang`、`og:url`、`og:image` |
| `sitemap.xml` | 全部 `<loc>` |
| `robots.txt` | `Sitemap:` |

> **nginx 注意**：`add_header` 不继承——只要某个 `location` 里出现 `add_header`，server 级的 `add_header` 就全部失效。`tools/texpro.conf` 已在每个带 `add_header` 的 location 里 `include` 安全头片段，新增 location 时务必照做，否则该 location 的响应会丢失全部安全头。

---

## 五、日常维护

### 本地预览
```bash
python3 -m http.server 8137
# 打开 http://127.0.0.1:8137/en.html 或 /cn.html
```
纯静态预览时 `inquiry.php` 不会真正提交（需要 PHP 运行时）。

### 校验（改完必跑）
```bash
python3 -I tools/check.py          # 0 错误即通过
python3 -I tools/check.py --strict # 警告也当失败
python3 -I tools/check.py --json   # 机器可读
```
覆盖：本地资源引用存在性、`?v=` 全站一致、`<html lang>`、每页唯一 `<h1>`、canonical/hreflang/og、标题不跳级、表单 `action`/`method` 与 `<noscript>` 兜底、占位与调试残留、敏感串、中英语言切换、`inquiry.php` 关键防护。

### 版本号规则
改动 `assets/css/style.css`、`assets/js/main.js`、`assets/scroll/*` 或图片后，把**全部 17 个页面**里的 `?v=` 统一 bump（当前值 `20261113c`）：
```bash
grep -rl '?v=20261113c' *.html | xargs sed -i '' 's/?v=20261113c/?v=20261114a/g'
python3 -I tools/check.py
```
新增/修改页面时同步：中英成对、导航与语言切换、`sitemap.xml`、canonical/hreflang/og、唯一 `<h1>`、`?v=`。

### 数据与隐私
- 运行时数据目录**不入仓库**（`.gitignore` 已排除），不得提交任何真实询盘内容。
- `inquiries.jsonl` 含姓名、邮箱、公司、留言、IP、UA 等个人信息，默认不轮转。留存期限与清理责任由部署方确定；建议至少每年清理一次并限制目录访问权限。
- 表单为公开询盘入口，无账号体系；后端已做同源校验、蜜罐、邮箱格式校验、原子限频。
- 若服务器前置 CDN/反代，需另行确认 `REMOTE_ADDR` 取到的是真实客户端 IP；本模板假设 nginx 直接面向客户端，无 CDN。

---

## 六、许可与说明

本仓库用于站点部署与维护。页面中的公司名、联系方式、备案号、品牌与产品图片属于 TEXPRO 业务资料；迁移到其他主体时请自行替换并确认授权。
