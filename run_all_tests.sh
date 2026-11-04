#!/bin/bash
# LabSpotter one-command local tests. Run from the project root: bash ./run_all_tests.sh
# 1) unit tests (chain/ guard, facts schema, server bounds, resource limits, head config, run_local.sh --check),
#    executed directly (no pytest needed).
# 2) GUI unit tests: node --test gui/tests/ (pure helpers in gui/src; needs Node >= 22.18 (type stripping), e.g. 24; older Node FAILS this step with a clear message), full output.
#    Reported SKIPPED only if node is missing.
# 3) GUI regression against a TEST STUB server (not the real backend, not real inference), full output.
#    Needs: playwright-core resolvable from gui/ (or NODE_PATH), Chrome at $CHROME (default /usr/bin/google-chrome),
#    and a built GUI in gui/dist (or DIST=/path). If any is missing, step 3 is reported SKIPPED (naming what is missing).
# Exit status is nonzero if the unit tests, the GUI unit tests or the GUI stub test fail.
set -u
cd "$(dirname "$0")"
UNIT_OK=1; GUIU_OK=1; GUI_OK=1
python3 - <<'PY' || UNIT_OK=0
import os,sys,types
sys.path.insert(0,"chain")
good=bad=0
for name in ("test_agent_entry","test_coach_recap_changes","test_facts_schema","test_server_bounds","test_resource_limits","test_analyze_slot","test_client_disconnect","test_head_launch_config","test_run_local","test_bench_session","test_bench_notes","test_glimpse","test_auth","test_hosted"):
    ok=0
    try:
        src=open(f"tests/{name}.py").read().replace('sys.path.insert(0,"/downloads/vid/work/chain")','')
        m=types.ModuleType(name); m.__file__=os.path.abspath(f"tests/{name}.py"); exec(compile(src,name,"exec"),m.__dict__)
    except Exception as e:
        bad+=1; print("FAIL",name,"(could not load)",repr(e)[:200]); continue
    for k,v in list(m.__dict__.items()):
        if k.startswith("test_") and callable(v):
            try: v(); ok+=1
            except Exception as e: bad+=1; print("FAIL",name,k,repr(e)[:200])
    good+=ok; print("UNIT",name,"passed",ok)
print(f"UNIT: {good} PASS, {bad} FAIL")
sys.exit(1 if bad else 0)
PY

if ! command -v node >/dev/null 2>&1; then
  echo "GUI UNIT: SKIPPED (missing: node)"
elif ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  GUIU_OK=0; echo "GUI UNIT: FAIL - node $(node -v) cannot run the .ts tests (type stripping needs Node >= 22.18, e.g. 24). Install a newer Node; this is a required prerequisite, not a skip."
else
  GUIU_LOG=$(mktemp)
  node --test gui/tests/ 2>&1 | tee "$GUIU_LOG"
  GUIU_RC=${PIPESTATUS[0]}
  GU_PASS=$(sed -n 's/^[^a-z]*pass \([0-9][0-9]*\)$/\1/p' "$GUIU_LOG" | tail -n 1)
  GU_FAIL=$(sed -n 's/^[^a-z]*fail \([0-9][0-9]*\)$/\1/p' "$GUIU_LOG" | tail -n 1)
  rm -f "$GUIU_LOG"
  if [ "$GUIU_RC" = 0 ] && [ "${GU_FAIL:-x}" = 0 ] && [ "${GU_PASS:-0}" -gt 0 ]; then
    echo "GUI UNIT: ${GU_PASS} PASS, 0 FAIL"
  else
    GUIU_OK=0; echo "GUI UNIT: ${GU_PASS:-?} PASS, ${GU_FAIL:-?} FAIL (exit $GUIU_RC)"
  fi
fi

DIST_DIR="${DIST:-gui/dist}"; CH="${CHROME:-/usr/bin/google-chrome}"
MISSING=()
[ -d "$DIST_DIR" ] || MISSING+=("built GUI at $DIST_DIR")
[ -x "$CH" ] || MISSING+=("Chrome at $CH")
(cd gui && node -e "require.resolve('playwright-core')") >/dev/null 2>&1 || MISSING+=("playwright-core")
if [ ${#MISSING[@]} -gt 0 ]; then
  LIST=$(printf '%s, ' "${MISSING[@]}")
  echo "GUI STUB E2E: SKIPPED (missing: ${LIST%, })"
else
  GUI_LOG=$(mktemp); trap 'rm -f "$GUI_LOG"' EXIT
  (cd gui && DIST="$(cd .. && cd "$DIST_DIR" && pwd)" CHROME="$CH" node e2e_stub_test_NOT_REAL_BACKEND.mjs) 2>&1 | tee "$GUI_LOG"
  GUI_RC=${PIPESTATUS[0]}
  if [ "$GUI_RC" != 0 ] || grep -q '^FAIL' "$GUI_LOG" || ! grep -q '^GUI STUB E2E: ' "$GUI_LOG"; then
    GUI_OK=0; echo "GUI STUB E2E: FAIL (exit $GUI_RC)"
  fi
fi

[ $UNIT_OK = 1 ] && [ $GUIU_OK = 1 ] && [ $GUI_OK = 1 ] && { echo "ALL TESTS: PASS"; exit 0; }
echo "ALL TESTS: FAIL"; exit 1
