#!/bin/bash
# Usage: tools/check_pickle_compat.sh VENV_A VENV_B [OUTDIR]
# Dumps frozen384 predictions under each venv's python, then compares them. Exit status = compare status.
set -u
[ $# -ge 2 ] || { echo "usage: $0 VENV_A VENV_B [OUTDIR]" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"; PY_SCRIPT="$HERE/check_pickle_compat.py"
OUT="${3:-$(mktemp -d /tmp/pickle_compat.XXXXXX)}"; mkdir -p "$OUT"
for V in "$1" "$2"; do [ -x "$V/bin/python" ] || { echo "no python at $V/bin/python" >&2; exit 2; }; done
echo "== dump A ($1)"; "$1/bin/python" -I "$PY_SCRIPT" --dump "$OUT/A.npz" || { echo "dump A failed" >&2; exit 3; }
echo "== dump B ($2)"; "$2/bin/python" -I "$PY_SCRIPT" --dump "$OUT/B.npz" || { echo "dump B failed" >&2; exit 3; }
echo "== compare"; "$2/bin/python" -I "$PY_SCRIPT" --compare "$OUT/A.npz" "$OUT/B.npz"; RC=$?
echo "outputs in $OUT; compare exit $RC"; exit $RC
