#!/bin/bash
# LabSpotter local run on THIS computer (not hosting): bash ./run_local.sh [--check | --check-wheels] [--port N]
# Checks Python >= 3.10, ffmpeg on PATH, a free port on 127.0.0.1 and the session token source, then creates
# app/.venv if missing, installs the CPU torch build plus the RUNBOOK known-good versions, and starts server.py
# bound to 127.0.0.1 only. --check does every check and prints what it would do; it creates, installs,
# downloads and starts nothing. --check-wheels (needs the package index, nothing is installed) asks the index whether
# every pinned package has a binary wheel for the Python that would run (PYTHON); exit 0 all found, 1 any missing,
# 3 index unreachable. The pins are the versions known to work here, chosen per Python version; not a lockfile.
# Env: PYTHON (default python3), LABSPOTTER_PORT (default 8765), LABSPOTTER_TOKEN (else the token file),
#      LABSPOTTER_RUN_DIR (default app/.run; holds the token file).
# The token is never printed, logged, put in a URL or passed as a command-line argument.
set -u
cd "$(dirname "$0")"
APP="$(pwd)"
die(){ echo "run_local.sh: ERROR: $*" >&2; exit 1; }

CHECK=0; WHEELS=0; PORT="${LABSPOTTER_PORT:-8765}"
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --check-wheels) WHEELS=1 ;;
    --port) [ $# -ge 2 ] || die "--port needs a number"; PORT="$2"; shift ;;
    -h|--help) echo "usage: bash ./run_local.sh [--check | --check-wheels] [--port N]"; exit 0 ;;
    *) die "unknown argument '$1' (usage: bash ./run_local.sh [--check | --check-wheels] [--port N])" ;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) die "port must be a number, got '$PORT'" ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "port must be 1-65535, got $PORT"

# 1) Python >= 3.10
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || die "Python interpreter '$PY' not found (set PYTHON=/path/to/python3.10+)"
PYVER="$("$PY" --version 2>&1)"
PYMM="$(echo "$PYVER" | sed -n 's/^Python \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')"
[ -n "$PYMM" ] || die "could not read the version of '$PY' (got: $PYVER)"
set -- $PYMM
if [ "$1" -lt 3 ] || { [ "$1" -eq 3 ] && [ "$2" -lt 10 ]; }; then
  die "Python 3.10 or newer is required; '$PY' is $PYVER (set PYTHON=/path/to/python3.10+)"
fi
echo "OK   Python: $PY ($PYVER)"
# Pillow 13.0.0 has no wheels for Python 3.10 (12.3.0 is the newest there), so the Pillow pin depends on the Python version.
if [ "$1" -eq 3 ] && [ "$2" -eq 10 ]; then PILLOW_PIN="Pillow==12.3.0"; else PILLOW_PIN="Pillow==13.0.0"; fi
TORCH_INDEX=https://download.pytorch.org/whl/cpu
if [ $WHEELS = 1 ]; then
  "$PY" -m pip --version >/dev/null 2>&1 || die "'$PY -m pip' is not available, so wheels cannot be checked"
  "$PY" -c 'import sys,urllib.request; [urllib.request.urlopen(u, timeout=10).close() for u in sys.argv[1:]]' https://pypi.org/simple/pip/ "$TORCH_INDEX/" >/dev/null 2>&1 \
    || { echo "WHEELS: UNREACHABLE (pypi.org or $TORCH_INDEX could not be reached; nothing was checked)"; exit 3; }
  MISS=0
  for spec in "torch==2.11.0+cpu@$TORCH_INDEX" "torchvision==0.26.0+cpu@$TORCH_INDEX" $(sed -n 's/^\([A-Za-z0-9_.-]*==[^ #]*\).*/\1/p' requirements.txt) "transformers==5.16.1" "$PILLOW_PIN"; do
    req="${spec%%@*}"; name="${req%%==*}"; ver="${req#*==}"; IDX=()
    [ "$spec" != "$req" ] && IDX=(--index-url "${spec#*@}")
    avail="$("$PY" -m pip index versions "$name" --only-binary=:all: "${IDX[@]}" 2>/dev/null | sed -n 's/^Available versions: //p')"
    if echo ", $avail," | grep -qF ", $ver,"; then echo "OK   wheel for $req on $PYVER"
    else echo "MISSING wheel for $req on $PYVER (index has: ${avail:-none})"; MISS=1; fi
  done
  [ $MISS = 0 ] && { echo "WHEELS: PASS (every pinned package has a wheel for $PYVER; nothing was installed)"; exit 0; }
  echo "WHEELS: FAIL (see MISSING lines; nothing was installed)"; exit 1
fi

# 2) ffmpeg on PATH
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg is not on PATH; install it (e.g. apt install ffmpeg, or brew install ffmpeg) and retry"
echo "OK   ffmpeg: $(command -v ffmpeg)"

# 3) port free on 127.0.0.1
"$PY" - "$PORT" <<'PY' || die "port $PORT is already in use on 127.0.0.1; stop whatever uses it or pick another with --port N"
import socket, sys
s = socket.socket()
try: s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError: sys.exit(1)
finally: s.close()
PY
echo "OK   port $PORT is free on 127.0.0.1"

# 4) session token source (the value itself is never shown)
RUN_DIR="${LABSPOTTER_RUN_DIR:-$APP/.run}"; TOKEN_FILE="$RUN_DIR/token"; MAKE_TOKEN=0
if [ -n "${LABSPOTTER_TOKEN:-}" ]; then
  TOKEN_WHERE="the LABSPOTTER_TOKEN environment variable you set"
  echo "OK   token: from LABSPOTTER_TOKEN (not shown)"
elif [ -e "$TOKEN_FILE" ]; then
  [ -f "$TOKEN_FILE" ] && [ -r "$TOKEN_FILE" ] || die "token file $TOKEN_FILE is not a readable regular file"
  MODE="$("$PY" -c 'import os,sys; print("%o" % (os.stat(sys.argv[1]).st_mode & 0o777))' "$TOKEN_FILE")"
  [ "$MODE" = 600 ] || die "token file $TOKEN_FILE has permissions $MODE; it must be 600 (owner read/write only). Fix with: chmod 600 $TOKEN_FILE"
  [ -s "$TOKEN_FILE" ] || die "token file $TOKEN_FILE is empty; delete it and run again to create a new one"
  TOKEN_WHERE="the file $TOKEN_FILE"
  echo "OK   token: from file $TOKEN_FILE (mode 600, not shown)"
else
  MAKE_TOKEN=1; TOKEN_WHERE="the file $TOKEN_FILE"
  if [ $CHECK = 1 ]; then echo "WOULD create token file $TOKEN_FILE (mode 600, random value from Python secrets)"
  else echo "Creating token file $TOKEN_FILE (mode 600, random value from Python secrets)"; fi
fi

VENV="$APP/.venv"; VPY="$VENV/bin/python"
# The pip bundled with a new venv can be old (23.0.1 with Python 3.10.12): it rejects the torch index's Jinja2 wheels
# (name case mismatch) and then fails building an sdist, so upgrade pip inside the venv first.
UPGRADE_PIP=("$VPY" -m pip install --upgrade pip)
# torchvision is required by the V-JEPA2 video processor (transformers AutoVideoProcessor); 0.26.0 is the release paired with torch 2.11.0.
INSTALL_TORCH=("$VPY" -m pip install "torch==2.11.0+cpu" "torchvision==0.26.0+cpu" --index-url "$TORCH_INDEX")
INSTALL_REST=("$VPY" -m pip install -r requirements.txt "transformers==5.16.1" "$PILLOW_PIN")
URL="http://127.0.0.1:$PORT/"
notes(){
  echo "URL: $URL"
  echo "Session token: read it yourself from $TOKEN_WHERE, then type it into Run > token in the GUI."
  echo "Note: the first real analysis downloads about 1.5 GB of encoder weights from the Hugging Face hub."
  echo "Note: this is a local run on this computer, not hosting. The server is bound to 127.0.0.1 only."
}

if [ $CHECK = 1 ]; then
  [ -x "$VPY" ] && echo "venv: $VENV exists (would reuse it)" || echo "WOULD create venv: $PY -m venv $VENV"
  echo "WOULD run: ${UPGRADE_PIP[*]}"
  echo "WOULD run: ${INSTALL_TORCH[*]}"
  echo "WOULD run: ${INSTALL_REST[*]}"
  echo "WOULD start: $VPY server.py --port $PORT --host 127.0.0.1  (token passed only via the LABSPOTTER_TOKEN env var)"
  notes
  echo "CHECK: PASS (dry run; nothing was created, installed, downloaded or started)"
  exit 0
fi

if [ $MAKE_TOKEN = 1 ]; then
  (umask 077 && mkdir -p "$RUN_DIR" && "$PY" -c 'import secrets; print(secrets.token_urlsafe(24))' > "$TOKEN_FILE") \
    || die "could not create token file $TOKEN_FILE"
fi
if [ -z "${LABSPOTTER_TOKEN:-}" ]; then LABSPOTTER_TOKEN="$(< "$TOKEN_FILE")"; fi

if [ ! -x "$VPY" ]; then
  echo "Creating venv: $VENV"
  "$PY" -m venv "$VENV" || die "could not create the venv at $VENV"
fi
echo "Upgrading pip in the venv: ${UPGRADE_PIP[*]}"
"${UPGRADE_PIP[@]}" || die "upgrading pip in the venv failed"
echo "Installing (CPU torch first): ${INSTALL_TORCH[*]}"
"${INSTALL_TORCH[@]}" || die "installing torch failed"
echo "Installing: ${INSTALL_REST[*]}"
"${INSTALL_REST[@]}" || die "installing requirements failed"

notes
echo "Starting server (Ctrl-C to stop)..."
# Piping through cat keeps server stdout off the terminal (it prints the token only to an interactive terminal).
LABSPOTTER_TOKEN="$LABSPOTTER_TOKEN" PYTHONUNBUFFERED=1 "$VPY" server.py --port "$PORT" --host 127.0.0.1 | cat
