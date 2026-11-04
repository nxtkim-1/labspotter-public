import contextlib, importlib, json, os, sys, tempfile, threading, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import voice_allowance as V
class Allowance(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(); self.root=self.t.name; self.path=os.path.join(self.root,'_voice_allowance.jsonl'); open(self.path,'w').close()
    def tearDown(self): self.t.cleanup()
    def test_restart_and_five_limit(self):
        for i in range(5):
            with V.reserve(self.root,'one',12): pass
        importlib.reload(V)
        with self.assertRaises(PermissionError):
            with V.reserve(self.root,'one',1): pass
    def test_hundred_global(self):
        for i in range(100):
            with V.reserve(self.root,str(i),12): pass
        with self.assertRaises(PermissionError):
            with V.reserve(self.root,'next',1): pass
        self.assertEqual(sum(json.loads(l)['seconds'] for l in open(self.path)),1200)
    def test_failed_call_not_refunded(self):
        try:
            with V.reserve(self.root,'one',2.1): raise TimeoutError()
        except TimeoutError: pass
        self.assertEqual(json.loads(open(self.path).read())['seconds'],3)
    def test_missing_and_corrupt_fail_closed(self):
        os.unlink(self.path)
        with self.assertRaises(PermissionError):
            with V.reserve(self.root,'one',1): pass
        open(self.path,'w').write('bad')
        with self.assertRaises(Exception):
            with V.reserve(self.root,'one',1): pass
    def test_parallel_busy_no_reservation(self):
        errors=[]
        with V.reserve(self.root,'one',1):
            def other():
                try:
                    with V.reserve(self.root,'two',1): pass
                except PermissionError: errors.append(1)
            t=threading.Thread(target=other); t.start(); t.join()
        self.assertEqual(errors,[1]); self.assertEqual(len(open(self.path).readlines()),1)
    def test_bounds(self):
        for n in (0,-1,30.01):
            with self.assertRaises(ValueError):
                with V.reserve(self.root,'one',n): pass
if __name__=='__main__': unittest.main()
