#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TEXPRO 官网静态校验（只读，纯标准库）。

用法：
    python3 -I tools/check.py            # 人类可读输出
    python3 -I tools/check.py --json     # 机器可读
    python3 -I tools/check.py --strict   # 警告也计为失败

退出码：0 = 通过；1 = 有错误（或 --strict 下有警告）。
"""

import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESC = re.compile(r"^(https?:|mailto:|tel:|data:|#|javascript:)", re.I)

errors = []
warns = []
stats = {}


def err(code, msg):
    errors.append({"code": code, "msg": msg})


def warn(code, msg):
    warns.append({"code": code, "msg": msg})


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


os.chdir(ROOT)
htmls = sorted(f for f in os.listdir(ROOT) if f.endswith(".html"))
texts = {f: read(f) for f in htmls}

# ---------- 1. 本地资源引用存在性 ----------
refs = {}
for f in htmls + ["assets/css/style.css", "assets/scroll/page-transition.css"]:
    raw = texts[f] if f in texts else read(f)
    # 只剥离「内联」script/style 内容；带 src 的 <script> 与 <link> 必须保留参与引用检查
    raw = re.sub(r"<script\b(?![^>]*\bsrc=)[^>]*>.*?</script>", "", raw, flags=re.S | re.I)
    raw = re.sub(r"<style\b[^>]*>.*?</style>", "", raw, flags=re.S | re.I)
    for m in re.finditer(r'(?:href|src)\s*=\s*"([^"]+)"|url\(\s*[\'"]?([^)\'"]+)', raw):
        p = m.group(1) or m.group(2)
        if not p or ESC.match(p):
            continue
        clean = p.split("#")[0].split("?")[0]
        if not clean or clean.startswith("/") or clean.startswith("page-transition.css"):
            continue
        refs.setdefault(clean, []).append("%s:%d" % (f, raw[: m.start()].count("\n") + 1))
missing = {k: v for k, v in refs.items() if not os.path.exists(k)}
stats["refs"] = len(refs)
if missing:
    for k, v in sorted(missing.items()):
        err("E101", "本地资源缺失：%s（引用自 %s）" % (k, ", ".join(v[:3])))

# ---------- 2. ?v= 版本号一致 ----------
vers = {}
for f in htmls:
    for v in re.findall(r"\?v=([0-9a-zA-Z]+)", texts[f]):
        vers.setdefault(v, set()).add(f)
stats["version"] = sorted(vers)
if len(vers) > 1:
    err("E201", "存在多个 ?v= 版本：%s" % {k: sorted(v) for k, v in vers.items()})
elif vers:
    only = list(vers)[0]
    # 每个引用静态资源的页面都应带版本号
    for f in htmls:
        asset = re.search(r'(?:href|src)="assets/[^"?]+\.(?:css|js)"', texts[f])
        if asset and "?v=" not in texts[f]:
            err("E202", "%s 引用静态资源但缺 ?v= 版本号" % f)

# ---------- 3. 页面成对与语言 ----------
for f in htmls:
    lang = re.search(r'<html[^>]*lang="([^"]+)"', texts[f])
    if not lang:
        err("E301", "%s 缺 <html lang>" % f)

# ---------- 4. h1 唯一 ----------
for f in htmls:
    n = len(re.findall(r"<h1\b", texts[f]))
    if n != 1:
        err("E401", "%s 的 <h1> 数量为 %d（应恰好 1）" % (f, n))

# ---------- 5. canonical / hreflang / og ----------
for f in htmls:
    if f == "index.html":
        continue
    if not re.search(r'<link rel="canonical"', texts[f]):
        err("E501", "%s 缺 canonical" % f)
    if not re.search(r'property="og:title"', texts[f]):
        err("E502", "%s 缺 og:title" % f)
    if not f.startswith("404"):
        for need in ('hreflang="zh-CN"', 'hreflang="en"', 'hreflang="x-default"'):
            if need not in texts[f]:
                err("E503", "%s 缺 %s" % (f, need))

# ---------- 6. 内页 h1 之后不得跳级到 h3 ----------
for f in htmls:
    seq = re.findall(r"<h([1-4])\b", texts[f])
    seen_h1 = False
    for lv in seq:
        if lv == "1":
            seen_h1 = True
        elif seen_h1 and lv == "3" and "2" not in seq:
            err("E601", "%s 的标题层级从 h1 直接跳到 h3" % f)
            break

# ---------- 7. 表单：原生回退与 noscript ----------
for f in htmls:
    if "<form" not in texts[f]:
        continue
    for fm in re.finditer(r"<form\b[^>]*>", texts[f]):
        tag = fm.group(0)
        if "action=" not in tag or "method=" not in tag:
            err("E701", "%s 的 <form> 缺 action/method（JS 失效时无法回退）：%s" % (f, tag))
    if "<noscript>" not in texts[f]:
        err("E702", "%s 有表单但缺 <noscript> 提示" % f)

# ---------- 8. 首页开屏遮罩必须有 noscript 兜底 ----------
for f in ("cn.html", "en.html"):
    if "#splash" in texts[f] and "<noscript>" not in texts[f]:
        err("E801", "%s 有开屏遮罩但缺 <noscript> 兜底" % f)

# ---------- 9. 占位与调试残留 ----------
for f in htmls:
    for kw in ("TODO", "FIXME", "Lorem ipsum", "待补充", "coming soon", "敬请期待"):
        if kw.lower() in texts[f].lower():
            warn("W901", "%s 含疑似占位文案：%s" % (f, kw))
    if re.search(r"console\.(log|debug)\s*\(", texts[f]):
        warn("W902", "%s 含 console 调试语句" % f)

# ---------- 10. 敏感路径/凭据 ----------
SENS = re.compile(r"(/Users/|/home/|192\.168\.|10\.0\.|password\s*[:=]|api[_-]?key\s*[:=]|BEGIN [A-Z ]*PRIVATE KEY)", re.I)
for f in htmls + ["inquiry.php", "README.md", "assets/js/main.js", "assets/scroll/fullpage-scroll.js"]:
    for m in SENS.finditer(read(f)):
        ln = read(f)[: m.start()].count("\n") + 1
        err("E1001", "%s:%d 含疑似敏感串：%s" % (f, ln, m.group(1)))

# ---------- 11. 页面互链 ----------
for f in htmls:
    alt = f.replace("-cn.html", "-en.html").replace("-en.html", "-cn.html")
    if alt in htmls and ("gn-lang" in texts[f]):
        if 'href="%s"' % alt not in texts[f]:
            err("E1101", "%s 的语言切换未指向 %s" % (f, alt))

# ---------- 12. 询盘后端关键防护 ----------
php = read("inquiry.php") if os.path.exists("inquiry.php") else ""
checks = {
    "flock(": "限频/写盘使用 flock",
    "http_response_code(405)": "非 POST 返回 405",
    "http_response_code(429)": "限频超限返回 429",
    "json_encode($record, JSON_UNESCAPED_UNICODE)": "记录 JSON 编码",
    "=== false": "json_encode 失败判空",
    "inquiry_same_origin": "同源校验",
    "FILTER_VALIDATE_EMAIL": "邮箱格式校验",
}
for needle, desc in checks.items():
    if needle not in php:
        err("E1201", "inquiry.php 缺少：%s（未找到 %r）" % (desc, needle))

# ---------- 输出 ----------
stats["html"] = len(htmls)
result = {"ok": not errors and not (warns and "--strict" in sys.argv), "errors": errors, "warnings": warns, "stats": stats}

if "--json" in sys.argv:
    print(json.dumps(result, ensure_ascii=False, indent=2))
else:
    print("TEXPRO 静态校验")
    print("  页面 %d 个；本地引用 %d 条；?v= %s" % (stats["html"], stats.get("refs", 0), ", ".join(stats.get("version", [])) or "无"))
    print("  错误 %d 条；警告 %d 条" % (len(errors), len(warns)))
    for e in errors:
        print("  [ERROR %s] %s" % (e["code"], e["msg"]))
    for w in warns:
        print("  [WARN  %s] %s" % (w["code"], w["msg"]))
    print("  结论：%s" % ("通过" if result["ok"] else "不通过"))

sys.exit(0 if result["ok"] else 1)
