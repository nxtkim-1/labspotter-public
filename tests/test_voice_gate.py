"""Offline tests for voice_gate: no network. Upstream is mocked; the key and URL are checked, never real."""
import io, os, sys, wave, json, unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chain"))
import tempfile
import voice_gate as V
import agent_entry as AE
def wav(sec=1.0, rate=16000, ch=1):
    b = io.BytesIO(); w = wave.open(b, "wb"); w.setnchannels(ch); w.setsampwidth(2); w.setframerate(rate); w.writeframes(b"\0\0" * int(rate * sec) * ch); w.close(); return b.getvalue()
class Resp:
    def __init__(s, o): s.o = o
    def read(s): return json.dumps(s.o).encode()
    def __enter__(s): return s
    def __exit__(s, *a): return False
def ledger(d, opening=True, cost=0.0):
    with open(os.path.join(d, "agent_ledger.jsonl"), "w") as f:
        if opening: f.write(json.dumps({"opening_reconciliation": True, "kind": "opening_reconciliation", "cost_usd": cost}) + "\n")
class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); AE.LEDGERS[:] = [os.path.join(self.d, "agent_ledger.jsonl")]
        V._CALLS = 0; os.environ.pop("LABSPOTTER_LIVE_CLEARED", None); os.environ.pop("MODEL_API_KEY", None)
    def test_off_by_default(self):
        with mock.patch("urllib.request.urlopen") as u:
            c, o = V.transcribe(wav()); self.assertEqual(c, 503); u.assert_not_called()
    def test_needs_both(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; self.assertFalse(V.status()[0])
        del os.environ["LABSPOTTER_LIVE_CLEARED"]; os.environ["MODEL_API_KEY"] = "k"; self.assertFalse(V.status()[0])
    def test_ok_and_request_shape(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "testkey-not-real"; ledger(self.d)
        with mock.patch("urllib.request.urlopen", return_value=Resp({"transcript": "Freeze it."})) as u:
            c, o = V.transcribe(wav())
        self.assertEqual(c, 200); self.assertEqual(o["transcript"], "Freeze it."); self.assertNotIn("testkey", json.dumps(o))
        rq = u.call_args[0][0]; self.assertEqual(rq.full_url, "https://api.meta.ai/v1/asr/transcribe")
        self.assertEqual(rq.get_header("Authorization"), "Bearer testkey-not-real"); self.assertIn(b'"mode": "PUSH_TO_TALK"', rq.data)
        self.assertIn(b'"model": "muse-voice-transcribe-1.0"', rq.data)
    def test_rejects_bad_audio_without_call(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d)
        with mock.patch("urllib.request.urlopen") as u:
            self.assertEqual(V.transcribe(b"junk")[0], 400)
            self.assertEqual(V.transcribe(wav(31))[0], 400)
            self.assertEqual(V.transcribe(wav(1, 16000, 2))[0], 400)
            u.assert_not_called()
    def test_cap(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d); V._CALLS = V.MAX_CALLS
        with mock.patch("urllib.request.urlopen") as u: self.assertEqual(V.transcribe(wav())[0], 429); u.assert_not_called()
    def test_upstream_failure_hides_key(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "secretvalue"; ledger(self.d)
        with mock.patch("urllib.request.urlopen", side_effect=RuntimeError("secretvalue boom")):
            c, o = V.transcribe(wav())
        self.assertEqual(c, 502); self.assertNotIn("secretvalue", json.dumps(o))
    def test_missing_ledger_refuses_without_call(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"
        with mock.patch("urllib.request.urlopen") as u:
            c, o = V.transcribe(wav()); self.assertEqual(c, 503); self.assertIn("ledger", o["message"]); u.assert_not_called()
    def test_no_opening_record_refuses(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d, opening=False)
        with mock.patch("urllib.request.urlopen") as u: self.assertEqual(V.transcribe(wav())[0], 503); u.assert_not_called()
    def test_cap_guard_blocks(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d, cost=AE.CAP)
        with mock.patch("urllib.request.urlopen") as u: self.assertEqual(V.transcribe(wav())[0], 503); u.assert_not_called()
    def test_success_appends_priced_ledger_line(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d)
        with mock.patch("urllib.request.urlopen", return_value=Resp({"transcript": "freeze"})): V.transcribe(wav(2.2))
        last = json.loads(open(AE.LEDGERS[0]).read().strip().splitlines()[-1])
        self.assertEqual((last["tag"], last["audio_seconds"]), ("voice_reserved", 3)); self.assertAlmostEqual(last["cost_usd"], 3 * 0.18 / 3600, places=6)
    def test_failed_call_stays_charged(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d)
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError()): V.transcribe(wav(1.0))
        self.assertAlmostEqual(AE.checked_aggregate(), 1 * 0.18 / 3600, places=6)
    def test_concurrent_cap(self):
        import threading
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d, cost=AE.CAP - 0.0002)
        res = []
        with mock.patch("urllib.request.urlopen", return_value=Resp({"transcript": "freeze"})):
            ts = [threading.Thread(target=lambda: res.append(V.transcribe(wav(1.0))[0])) for _ in range(8)]
            [x.start() for x in ts]; [x.join() for x in ts]
        self.assertEqual(res.count(200), 4); self.assertLessEqual(AE.checked_aggregate(), AE.CAP)
    def test_voice_call_limit_env(self):
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"; ledger(self.d); os.environ["LABSPOTTER_VOICE_MAX_CALLS"] = "5"
        try:
            with mock.patch("urllib.request.urlopen", return_value=Resp({"transcript": "freeze"})):
                codes = [V.transcribe(wav(1.0))[0] for _ in range(7)]
            self.assertEqual(codes.count(200), 5); self.assertEqual(codes[-1], 503)
        finally: os.environ.pop("LABSPOTTER_VOICE_MAX_CALLS")
    def test_intents(self):
        self.assertEqual(V.intent("Okay, freeze it."), "freeze"); self.assertEqual(V.intent("Save the result."), "save")
        self.assertEqual(V.intent("Start a new session"), "start")
        for t in ("approve the step", "acknowledge the difference", "the resume token is abc", "clear safety", ""): self.assertIsNone(V.intent(t))
if __name__ == "__main__": unittest.main()
