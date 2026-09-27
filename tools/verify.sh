#!/usr/bin/env bash
# 一把梭复验：单测 → 起静态服 → 无头 Chrome 真指针通关 → 截图。
#
# 不要加 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader：
# 软件光栅会把十几个核打满，而且没有 CDP 客户端时进程不会自己退。
#
#   ./tools/verify.sh                    # 全跑
#   KINDS=pegsolitaire ./tools/verify.sh # 只复验一种玩法（跳过单测用 SKIP_UNIT=1）
set -u
# pipefail 是这条脚本自己的命门：`node --test test/ | tail -14` 在 bash 里取的是 tail 的
# 退出码，单测全红也会一路往下跑，最后报 ALL GREEN。
set -o pipefail

# 失败必须从"退出码 1"变成"哪一条红了"。GitHub 的 job 日志对只有 contents 权限的
# token 是 403（要 admin），而 .playtest/ 在 .gitignore 里，upload-artifact 从来没把
# 截图传上来过 —— 于是 CI 一红就只能靠猜。workflow 命令打的注解走 check-run
# annotations 那条路，读得到，所以把结论写在那里。
note() { printf '::%s::%s\n' "$1" "$(printf '%s' "$2" | tr -d '\r\n' | cut -c1-500)"; }

HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP=${CDP_PORT:-9335}
# 5173 在本机常被别的项目的 dev server 占着，绑失败会静默对旧端口做测试，所以默认另起。
SPORT=${SPORT:-5188}
BASE="http://127.0.0.1:${SPORT}/"
SHOTS=${SHOT_DIR:-$HERE/.playtest}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { note error "找不到 Chrome（试过 google-chrome / chromium / chromium-browser）"; echo "找不到 Chrome，请设 CHROME_BIN" >&2; exit 2; }
note notice "Chrome=$CHROME node=$(node -v) cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

cd "$HERE"
FAILED=0

if [ -z "${SKIP_UNIT:-}" ]; then
  echo "=== 单测（引擎纯逻辑，无浏览器）==="
  # 报告器必须显式指定：stdout 不是 tty 时 node 22 自己切去 tap（"# tests"/"not ok"），
  # 而 node 26 仍旧给 spec（"ℹ tests"/"✖"）—— 于是下面这些 grep 在 CI 上一条都不命中，
  # 红了却看不出是哪条。钉死 spec 让两边格式一致。
  node --test --test-reporter=spec test/ > /tmp/nikoli-unit.log 2>&1 || FAILED=1
  tail -14 /tmp/nikoli-unit.log
  grep -E "^ℹ (tests|pass|fail)" /tmp/nikoli-unit.log | while read -r l; do note notice "unit $l"; done
  grep -E "^✖" /tmp/nikoli-unit.log | head -12 | while read -r l; do note error "unit $l"; done
  [ $FAILED -eq 0 ] || sed -n '/^✖ /,+28p' /tmp/nikoli-unit.log | head -60
fi

echo "=== 静态服 :$SPORT ==="
node tools/serve.mjs "$SPORT" >/tmp/nikoli-serve.log 2>&1 &
SPID=$!
UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP --user-data-dir=$UDD \
  --window-size=860,640 --no-first-run --no-default-browser-check --mute-audio \
  about:blank >/tmp/nikoli-chrome.log 2>&1 &
CPID=$!
cleanup() { kill $SPID 2>/dev/null; kill -9 $CPID 2>/dev/null; rm -rf $UDD; }
trap cleanup EXIT
# 看门狗要重定向自己的 fd：后台子 shell 会继承脚本 stdout，跑在管道里就会把写端
# 一直握着，测试早就完了下游却还在等。
( sleep ${WD_TIMEOUT:-300}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# 静态服 bind 也要等端点：紧跟着 curl 会在它监听之前就跑完。
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || { note error "静态服没起来（:$SPORT）$(tail -3 /tmp/nikoli-serve.log | tr -d '\r\n')"; echo "静态服没起来：$(cat /tmp/nikoli-serve.log)" >&2; exit 3; }
# 光"端口有人应答"不够：本机同时跑着一堆别的会话的 dev server，绑不上端口时它们会替我们
# 把 curl 答了，于是整套无头复验其实是在别人的站上找 window.nikoli —— 报出来的却是"页面没起来"。
# 所以按标题认一句"这是本站"，认不出就换 SPORT 重来，绝不拿别人的页面当证据。
PAGE_HTML=$(curl -fsS -m 3 "$BASE" 2>/dev/null || true)
printf '%s' "$PAGE_HTML" | grep -q "纸上逻辑 Nikoli" || {
  note error ":$SPORT 上服务着的不是本站（HTML 里没有『纸上逻辑 Nikoli』）—— 换个 SPORT 再跑"
  echo "$SPORT 端口上是别人的页面：$(printf '%s' "$PAGE_HTML" | head -c 200)" >&2
  exit 4; }
[ -s /tmp/nikoli-serve.log ] && grep -qi "EADDRINUSE\|address already in use" /tmp/nikoli-serve.log && {
  note error "静态服其实没绑上 :$SPORT（EADDRINUSE），答话的是别家进程"; exit 4; }

# 全新 --user-data-dir 绑定 DevTools 比热档慢，等端点而不是猜 sleep。
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 || {
  note error "DevTools 没在 :$CDP 上监听 $(tail -4 /tmp/nikoli-chrome.log | tr -d '\r\n')"
  echo "DevTools 没在 :$CDP 上监听" >&2; exit 3; }

echo "=== 无头通关（真指针事件）==="
mkdir -p "$SHOTS"
CDP_PORT=$CDP BASE_URL=$BASE SHOT_DIR=$SHOTS node tools/playtest.mjs > "$SHOTS/result.json" 2>&1 || FAILED=1
python3 - "$SHOTS/result.json" <<'PY'
import json, sys
def ann(level, text):
    # 走 annotation 而不是 stdout：CI 的日志对 contents-only token 是 403。
    print('::%s::%s' % (level, text.replace('\r', ' ').replace('\n', ' ')[:500]))
raw = open(sys.argv[1]).read()
try:
    i, j = raw.index('{'), raw.rindex('}')
    d = json.loads(raw[i:j + 1])
except Exception:
    print('  无头复验没吐出 JSON：\n' + raw[-800:])
    ann('error', 'playtest 没吐出 JSON：' + raw[-400:]); sys.exit(1)
for r in d['rows']:
    print(('  ok   ' if r['pass'] else '  FAIL ') + r['test'] + ('' if r['pass'] else '  ← ' + json.dumps(r['detail'], ensure_ascii=False)[:300]))
for r in d['rows']:
    if not r['pass']:
        ann('error', 'playtest FAIL ' + r['test'] + ' ' + json.dumps(r['detail'], ensure_ascii=False)[:300])
for e in (d.get('errors') or [])[:6]:
    ann('error', 'console ' + str(e)[:300])
print('rows: %d  fail: %s  errors: %s' % (len(d['rows']), d['fail'], d.get('errors')))
ann('notice', 'playtest rows=%d fail=%s' % (len(d['rows']), d['fail']))
sys.exit(1 if d['fail'] or len(d['rows']) < 20 else 0)
PY
PYRC=$?
[ $PYRC -ne 0 ] && FAILED=1

kill $WD 2>/dev/null
echo "=== 截图：$SHOTS ==="
ls -1 "$SHOTS" 2>/dev/null | sed 's/^/  /'
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== 上方有失败 ==="
exit $FAILED
