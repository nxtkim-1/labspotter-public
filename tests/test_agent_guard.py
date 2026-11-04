import os, sys, json, tempfile, unittest, threading
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chain"))
import agent_entry as A
class R:
    def __init__(s, o): s.o = o
    def read(s): return json.dumps(s.o).encode()
OUT = {"output": [{"content": [{"type": "output_text", "text": json.dumps({"steps": [], "possible_mistakes": []})}]}], "usage": {"input_tokens": 500, "output_tokens": 900}}
class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); os.environ["LABSPOTTER_RUNS"] = self.d; A.LEDGERS[:] = [os.path.join(self.d, "agent_ledger.jsonl")]
        os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "k"
        open(A.LEDGERS[0], "w").write(json.dumps({"opening_reconciliation": True, "cost_usd": 0}) + "\n")
    def test_reserve_before_call_and_max(self):
        with mock.patch("urllib.request.urlopen", return_value=R(OUT)):
            A.call_meta([], True, "t1")
        agg = A.checked_aggregate(); mx = (A.MAXIN_BYTES + A.MARGIN) * 1.25 / 1e6 + 1500 * 4.25 / 1e6
        self.assertLess(agg, mx); self.assertGreater(agg, 1500 * 4.25 / 1e6)
        led = [json.loads(l) for l in open(A.LEDGERS[0]) if l.strip()]
        self.assertEqual(len(led), 3); self.assertEqual(led[-1]["cost_usd"], 0)   # settle line adds no cost: no double count
        self.assertAlmostEqual(agg, led[1]["cost_usd"], places=6)
    def test_timeout_stays_charged(self):
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError()):
            try: A.call_meta([], True, "t2")
            except Exception: pass
        self.assertGreater(A.checked_aggregate(), 0.0090)
    def test_missing_ledger_refuses(self):
        os.remove(A.LEDGERS[0])
        with mock.patch("urllib.request.urlopen") as u:
            with self.assertRaises(SystemExit): A.call_meta([], True, "t3")
            u.assert_not_called()
    def test_test_ceiling_and_call_limit(self):
        os.environ["LABSPOTTER_TEST_CEILING_USD"] = "0.0596"; os.environ["LABSPOTTER_AGENT_MAX_CALLS"] = "3"
        try:
            ok = 0
            with mock.patch("urllib.request.urlopen", return_value=R(OUT)):
                for i in range(6):
                    try: A.call_meta([], True, "k%d" % i); ok += 1
                    except SystemExit: pass
            self.assertEqual(ok, 3); self.assertLessEqual(A.checked_aggregate(), 0.0596)
        finally: os.environ.pop("LABSPOTTER_TEST_CEILING_USD"); os.environ.pop("LABSPOTTER_AGENT_MAX_CALLS")
    def test_input_cap(self):
        big = [{"claim": "x" * 12000, "t_start": 0, "t_end": 1, "score": .1, "status": "s"}]
        with mock.patch("urllib.request.urlopen") as u:
            with self.assertRaises(SystemExit): A.call_meta(big, True, "t4")
            u.assert_not_called()
    def test_concurrent_cap(self):
        open(A.LEDGERS[0], "w").write(json.dumps({"opening_reconciliation": True, "cost_usd": A.CAP - 0.02}) + "\n")
        res = []
        def go(i):
            try: A.call_meta([], True, "c%d" % i); res.append(1)
            except SystemExit: res.append(0)
        with mock.patch("urllib.request.urlopen", return_value=R(OUT)):
            ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]; [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(sum(res), 2)  # reservation ~0.0158 each => 2 fit in 0.04; self.assertLessEqual(A.checked_aggregate(), A.CAP)
if __name__ == "__main__": unittest.main()
