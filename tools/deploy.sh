#!/usr/bin/env bash
# TEXPRO 官网部署脚本（人工触发；CI 未接入）
#
# 用法：
#   tools/deploy.sh user@host:/var/www/texpro/ --dry-run   # 先看会传什么
#   tools/deploy.sh user@host:/var/www/texpro/             # 正式同步
#   BASE_URL 可用第三个参数覆盖，默认 https://www.texpro.com.cn
#
# 流程：静态校验 → rsync（--delete，排除 .git）→ 部署后逐 URL 状态码校验。
# 注意：--delete 会删除目标端多余文件；首次使用请务必先 --dry-run。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:?用法: tools/deploy.sh user@host:/var/www/texpro/ [--dry-run]}"
DRY="${2:-}"
BASE="${3:-https://www.texpro.com.cn}"

echo "==> 1/4 静态校验"
python3 -I "$ROOT/tools/check.py"

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
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/$p" || echo 000)
  printf '  %-28s %s\n' "$p" "$code"
  case "$p" in
    404.html) [[ "$code" == "404" || "$code" == "200" ]] || FAIL=1 ;;
    *)        [[ "$code" == "200" ]] || FAIL=1 ;;
  esac
done

if [[ "$FAIL" != "0" ]]; then
  echo "==> 部署校验失败：请检查上面的状态码"
  exit 1
fi
echo "==> 4/4 完成"
