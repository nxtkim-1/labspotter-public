"""Offline tests for agent_entry.glimpse: upstream mocked, no network, no real key."""
import os, sys, json, tempfile, io
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chain")) if "__file__" in globals() else None
sys.path.insert(0, "chain")
import agent_entry as A
def _setup(opening=True, cost=0.0):
    d = tempfile.mkdtemp(); A.LEDGERS[:] = [os.path.join(d, "agent_ledger.jsonl")]
    with open(A.LEDGERS[0], "w") as f:
        if opening: f.write(json.dumps({"opening_reconciliation": True, "cost_usd": cost}) + "\n")
    os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "mock-not-real"; os.environ.pop("LABSPOTTER_GLIMPSE_MAX_CALLS", None); os.environ.pop("LABSPOTTER_TEST_CEILING_USD", None)
class _R:
    def read(s): return json.dumps({"output": [{"content": [{"type": "output_text", "text": "Hands hold a flask."}]}], "usage": {"input_tokens": 480, "output_tokens": 400}}).encode()
def test_ok_reserves_before_call_and_logs():
    _setup(); seen = {}
    def fake(req, timeout=0):
        seen["ledger_at_call"] = open(A.LEDGERS[0]).read(); return _R()
    with mock.patch("urllib.request.urlopen", fake): t = A.glimpse(b"x" * 100, "video/mp4", "t")
    assert t == "Hands hold a flask." and "glimpse_reserved" in seen["ledger_at_call"]
    assert json.loads(open(A.LEDGERS[0]).read().splitlines()[-1])["tag"] == "t"
def test_off_without_key():
    _setup(); os.environ.pop("MODEL_API_KEY")
    try: A.glimpse(b"x", "video/mp4", "t"); assert False
    except SystemExit: pass
def test_missing_ledger_refuses_and_no_call():
    _setup(opening=False)
    with mock.patch("urllib.request.urlopen") as u:
        try: A.glimpse(b"x", "video/mp4", "t"); assert False
        except SystemExit: pass
        u.assert_not_called()
def test_cap_and_size_and_type_and_max_calls():
    _setup(cost=9.999)
    with mock.patch("urllib.request.urlopen") as u:
        for args in [(b"x", "video/mp4"), (b"x" * (A.GLIMPSE_MAX_BYTES + 1), "video/mp4"), (b"x", "text/plain")]:
            try: A.glimpse(*args, "t"); assert False
            except SystemExit: pass
        u.assert_not_called()
    _setup(); os.environ["LABSPOTTER_GLIMPSE_MAX_CALLS"] = "1"
    with mock.patch("urllib.request.urlopen", lambda r, timeout=0: _R()):
        A.glimpse(b"x", "video/mp4", "t")
        try: A.glimpse(b"x", "video/mp4", "t"); assert False
        except SystemExit: pass
def test_http_error_stays_reserved_and_key_not_leaked():
    _setup()
    import urllib.error
    def boom(req, timeout=0): raise urllib.error.HTTPError("u", 500, "e", {}, io.BytesIO(b"bad mock-not-real"))
    with mock.patch("urllib.request.urlopen", boom): t = A.glimpse(b"x", "video/mp4", "t")
    led = open(A.LEDGERS[0]).read(); assert t == "" and "glimpse_reserved" in led and "mock-not-real" not in led
if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"): v(); print("ok", k)
