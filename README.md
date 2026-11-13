# TEXPRO Website

TEXPRO（南京舜特斯普家居用品有限公司）中英文官网：静态 HTML/CSS/JS + 单一 PHP 询盘接口。
线上：<https://www.texpro.com.cn/>（nginx + PHP-FPM，自管云主机）。

## 目录

```
*.html                 18 个页面：中英成对（7 对）+ 首页 cn/en + index 门户 + 404
assets/css/style.css   全站样式
assets/js/main.js      导航/轮播/产品分类/表单提交
assets/scroll/         首页整屏翻页（page-transition.css + fullpage-scroll.js）
assets/img|media|products/  图片与视频（约 96 MiB）
inquiry.php            询盘接口（写 JSONL + best-effort 邮件通知）
tools/check.py         静态校验（只读，CI/本地共用）
tools/deploy.sh        部署脚本（人工触发）
tools/site.conf        nginx 片段（安全头/301/robots/404/POST 限制）
robots.txt sitemap.xml SEO 静态文件
```

## 本地预览

```bash
python3 -m http.server 8137
# 打开 http://127.0.0.1:8137/en.html 或 /cn.html
```

`inquiry.php` 需要 PHP 运行时，纯静态预览时表单不会真正提交。

## 校验（改完必跑）

```bash
python3 -I tools/check.py          # 0 错误即通过
python3 -I tools/check.py --strict # 警告也当失败
```

覆盖：本地资源引用存在性、`?v=` 版本一致、`<html lang>`、每页唯一 `<h1>`、canonical/hreflang/og、
表单 `action`/`method` 与 `<noscript>` 兜底、占位与调试残留、敏感串、中英语言切换、询盘后端关键防护。

## 部署（人工触发，先 dry-run）

```bash
tools/deploy.sh user@host:/var/www/texpro/ --dry-run   # 预览变更
tools/deploy.sh user@host:/var/www/texpro/             # 正式同步 + 部署后状态码校验
```

`rsync --delete` 会删除远端多余文件；首次使用务必先 `--dry-run`。
nginx 配置改动见 `tools/site.conf`，需在服务器上合入并 `nginx -t && nginx -s reload`。

## 版本号规则

改动 `assets/css/style.css`、`assets/js/main.js`、`assets/scroll/*` 或图片后，把**全部页面**里的
`?v=YYYYMMDDx` 统一 bump 到同一天的新后缀（例：`?v=20261103b` → `?v=20261114a`），

```bash
# 一键替换（示例）
grep -rl '?v=20261103b' *.html | xargs sed -i '' 's/?v=20261103b/?v=20261114a/g'
python3 -I tools/check.py
```

新增/修改页面时同步：中英成对、导航与语言切换、`sitemap.xml`、canonical/hreflang/og、唯一 `<h1>`。

## 运行时数据与隐私

- `inquiry.php` 把询盘写入 `/var/www/texpro-data/inquiries/inquiries.jsonl`（可用 `TEXPRO_DATA_DIR` 覆盖）；
  限频计数在 `/var/www/texpro-data/ratelimit/`；`mail()` 失败写 `/var/www/texpro-data/mail-errors.log`。
- 这些数据**不入仓库**（`.gitignore` 已排除），也不得提交任何真实询盘内容。
- JSONL 含姓名、邮箱、公司、留言、IP、UA 等个人信息，默认不轮转。留存期限与清理责任需业务方确认；
  建议至少每年清理一次，并限制数据目录访问权限（当前 `0750`）。
- 表单为公开询盘入口，无账号体系；后端已做同源校验、蜜罐、邮箱格式校验、原子限频（每 IP 每小时 5 次）。

## 已知待办

- `assets/` 中有 44 个历史遗留、当前无引用的素材（约 5.05 MiB），清理前需确认无回溯需求。
- 线上 nginx 安全头、`robots.txt`/`sitemap.xml`、裸域 301、`/404.html` 直访状态码需按 `tools/site.conf` 部署后才生效。
- 服务器 PHP 版本 / MTA / 是否前置 CDN 未核实；`REMOTE_ADDR` 在 CDN 后需另行处理。
