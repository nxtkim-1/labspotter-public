"""TEST ONLY: runs server.py with a mocked Meta upstream so the browser mic path can be exercised offline. Never used by run_local.sh."""
import os, sys, json, runpy, io
from unittest import mock
os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "mock-not-a-real-key"
_runs = os.environ.setdefault("LABSPOTTER_RUNS", "/tmp/voice_mock_runs"); os.makedirs(_runs, exist_ok=True)
_led = os.path.join(_runs, "agent_ledger.jsonl")
if not os.path.exists(_led): open(_led, "w").write(json.dumps({"opening_reconciliation": True, "note": "TEST ONLY mock ledger, not real spend history", "cost_usd": 0}) + "\n")
class R:
    def read(s): return json.dumps({"transcript": os.environ.get("MOCK_SAY", "Okay, start a new session.")}).encode()
    def __enter__(s): return s
    def __exit__(s, *a): return False
sys.argv = ["server.py"] + sys.argv[1:]
with mock.patch("urllib.request.urlopen", return_value=R()):
    runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), run_name="__main__")
