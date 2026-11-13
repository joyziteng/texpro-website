#!/usr/bin/env bash
# TEXPRO 官网部署脚本（人工触发；CI 未接入）
#
# 用法：
#   tools/deploy.sh <user@host:/var/www/texpro/> <https://主域/> [--dry-run]
#
# 示例：
#   tools/deploy.sh deploy@your-host:/var/www/texpro/ https://www.example.com/ --dry-run
#   tools/deploy.sh deploy@your-host:/var/www/texpro/ https://www.example.com/
#
# 参数说明：
#   $1  rsync 目标（必填）
#   $2  部署后校验用的完整站点 URL（必填，含协议与结尾斜杠）
#   $3  --dry-run 时只预览变更，不写远端、不做部署后校验
#
# 流程：静态校验 → rsync（--delete，排除 .git/ 与 tools/）→ 部署后逐 URL 状态码校验。
# 注意：--delete 会删除目标端多余文件；首次使用请务必先 --dry-run。
# 环境要求见 README.md 第二节。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:?用法: tools/deploy.sh <user@host:/var/www/texpro/> <https://主域/> [--dry-run]}"
BASE="${2:?请提供部署后校验用的完整站点 URL，例如 https://www.example.com/}"
DRY="${3:-}"

echo "==> 1/4 静态校验"
python3 -I "$ROOT/tools/check.py"

# favicon.ico 常来自下载附件，可能带 600 权限；rsync 会保留权限，
# 传到服务器后 nginx 读不到会返回 403。统一改成 644。
chmod 644 "$ROOT/favicon.ico"

echo "==> 2/4 同步到 $TARGET ${DRY:+（dry-run）}"
RSYNC=(rsync -avz --delete
  --exclude '.git/'
  --exclude '.DS_Store'
  --exclude 'tools/'
  --exclude '*.bak*')
[[ "$DRY" == "--dry-run" ]] && RSYNC+=(--dry-run)
"${RSYNC[@]}" "$ROOT/" "$TARGET"

if [[ "$DRY" == "--dry-run" ]]; then
  echo "==> dry-run 结束，未改动远端。"
  exit 0
fi

echo "==> 3/4 部署后校验（$BASE）"
FAIL=0
for p in index.html cn.html en.html about-cn.html products-cn.html contact-cn.html robots.txt sitemap.xml 404.html; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE$p" || echo 000)
  printf '  %-28s %s\n' "$p" "$code"
  case "$p" in
    404.html) [[ "$code" == "404" ]] || FAIL=1 ;;
    *)        [[ "$code" == "200" ]] || FAIL=1 ;;
  esac
done

if [[ "$FAIL" != "0" ]]; then
  echo "==> 部署校验失败：请检查上面的状态码"
  exit 1
fi
echo "==> 4/4 完成"
