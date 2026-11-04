#!/bin/bash
# LabSpotter offline smoke test (no model, no network, no Meta). Run from the project root of a clean extract: ./smoke.sh
# Starts the backend on a free localhost port with a random token held only in this script's memory, checks health/auth/validation, stops it.
set -u; cd "$(dirname "$0")"
PORT=$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1])")
RUNS=$(mktemp -d); TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(18))")
LABSPOTTER_RUNS="$RUNS" LABSPOTTER_TOKEN="$TOKEN" python3 server.py --port "$PORT" >/tmp/ls_smoke_$$.log 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null; rm -rf "$RUNS"; rm -f /tmp/ls_smoke_$$.log' EXIT
for i in $(seq 1 40); do python3 -c "import urllib.request,sys;urllib.request.urlopen('http://127.0.0.1:$PORT/api/health',timeout=1)" 2>/dev/null && break; sleep 0.25; done
FAIL=0
code(){ python3 - "$@" <<'PY'
import sys,urllib.request,urllib.error
m,path,tok,body=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
h={"Host":"127.0.0.1:%s"%sys.argv[5]}
if tok!="-": h["X-LabSpotter-Token"]=tok
r=urllib.request.Request("http://127.0.0.1:%s%s"%(sys.argv[5],path),data=(body.encode() if body!="-" else None),method=m,headers=h)
try: print(urllib.request.urlopen(r,timeout=5).status)
except urllib.error.HTTPError as e: print(e.code)
PY
}
chk(){ if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; else echo "FAIL $1 got $2 want $3"; FAIL=1; fi; }
chk "health without token (public summary)" "$(code GET /api/health - - $PORT)" 200
chk "protected route without token" "$(code GET /api/runs/none - - $PORT)" 401
chk "protected route wrong token" "$(code GET /api/runs/none wrong - $PORT)" 401
chk "protected route right token, no such run" "$(code GET /api/runs/none "$TOKEN" - $PORT)" 404
chk "analyze bad tag" "$(code POST '/api/analyze?tag=bad.tag' "$TOKEN" x $PORT)" 400
chk "analyze without token" "$(code POST '/api/analyze?tag=t1' - x $PORT)" 401
if grep -q "$TOKEN" /tmp/ls_smoke_$$.log; then echo "FAIL token found in server log"; FAIL=1; else echo "PASS token not in server log"; fi
[ -d gui/dist ] && chk "static index" "$(code GET / - - $PORT)" 200 || echo "SKIP static index (no gui/dist in this archive)"
[ $FAIL = 0 ] && echo "SMOKE: PASS" || { echo "SMOKE: FAIL"; exit 1; }
