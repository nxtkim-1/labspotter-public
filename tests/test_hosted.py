"""Hosted mode over real HTTP (real server.py process, temp store, no Meta, no encoder): accounts, per-user isolation, blocked routes."""
import http.client, json, os, socket, subprocess, sys, tempfile, time, unittest
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
class T(unittest.TestCase):
    @classmethod
    def setUpClass(c):
        c.port = free_port(); c.runs = tempfile.mkdtemp()
        env = dict(os.environ, LABSPOTTER_HOSTED="1", LABSPOTTER_RUNS=c.runs, LABSPOTTER_INVITE_CODE="let-me-in")
        env.pop("MODEL_API_KEY", None)
        c.p = subprocess.Popen([sys.executable, "server.py", "--port", str(c.port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try: socket.create_connection(("127.0.0.1", c.port), 0.2).close(); break
            except OSError: time.sleep(0.1)
    @classmethod
    def tearDownClass(c): c.p.terminate(); c.p.wait()
    def req(self, method, path, body=None, cookie="", origin=True):
        h = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hd = {"Host": f"127.0.0.1:{self.port}"}
        if origin is True: hd["Origin"] = f"http://127.0.0.1:{self.port}"
        elif origin: hd["Origin"] = origin
        if cookie: hd["Cookie"] = cookie
        data = json.dumps(body).encode() if body is not None else None
        if data: hd["Content-Type"] = "application/json"
        h.request(method, path, data, hd); r = h.getresponse(); b = r.read()
        try: j = json.loads(b)
        except ValueError: j = {}
        return r.status, j, r.getheader("Set-Cookie") or ""
    def signup(self, n):
        st, j, ck = self.req("POST", "/api/auth/signup", {"username": n, "password": "correct horse battery", "invite": "let-me-in"})
        self.assertEqual(st, 201, j); return ck.split(";")[0], ck
    def test_everything(self):
        st, j, _ = self.req("GET", "/api/auth/me"); self.assertEqual((st, j["user"], j["signup"]), (200, None, "invite"))
        st, j, _ = self.req("POST", "/api/auth/signup", {"username": "mallory", "password": "correct horse battery", "invite": "wrong"}); self.assertEqual(st, 403)
        ca, full = self.signup("alice"); cb, _ = self.signup("bobby")
        self.assertIn("HttpOnly", full); self.assertIn("SameSite=Strict", full)
        self.assertEqual(self.req("GET", "/api/auth/me", cookie=ca)[1]["user"]["name"], "alice")
        self.assertEqual(self.req("GET", "/api/bench/sessions")[0], 401)  # no cookie
        self.assertEqual(self.req("GET", "/api/bench/sessions", cookie="ls_session=forged")[0], 401)
        st, j, _ = self.req("POST", "/api/bench/session", {"name": "alice bench"}, cookie=ca); self.assertEqual(st, 201, j)
        sid = j.get("session_id") or j.get("id") or ""; self.assertTrue(sid, j)
        sa = self.req("GET", "/api/bench/sessions", cookie=ca)[1]; sb = self.req("GET", "/api/bench/sessions", cookie=cb)[1]
        self.assertEqual(len(sa["sessions"]), 1); self.assertEqual(len(sb["sessions"]), 0)
        self.assertNotEqual(self.req("GET", "/api/bench/session/" + sid, cookie=cb)[0], 200)  # bobby cannot open alice's session
        for path in ("/api/voice/transcribe", "/api/agent/glimpse"):
            self.assertEqual(self.req("POST", path, {}, cookie=ca)[0], 403, path)  # Meta-capable routes stay off on the hosted site
        self.assertEqual(self.req("POST", "/api/analyze?tag=x1", None)[0], 401)  # no cookie, no analysis
        self.assertEqual(self.req("GET", "/api/runs/x1")[0], 401)
        self.assertEqual(self.req("GET", "/api/runs/nope1", cookie=ca)[0], 404)  # signed in, no such run in alice's own store
        h = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h.request("POST", "/api/analyze?tag=big1", None, {"Host": f"127.0.0.1:{self.port}", "Origin": f"http://127.0.0.1:{self.port}", "Cookie": ca, "Content-Length": str(30 * 1024 * 1024)})
        self.assertEqual(h.getresponse().status, 413)  # over the hosted clip limit, refused before reading the body
        self.assertEqual(self.req("POST", "/api/auth/login", {"username": "alice", "password": "correct horse battery"}, origin=False)[0], 403)  # needs Origin
        self.assertEqual(self.req("POST", "/api/auth/login", {"username": "alice", "password": "correct horse battery"}, origin="https://evil.example")[0], 403)
        self.assertEqual(self.req("POST", "/api/auth/login", {"username": "alice", "password": "nope nope nope"})[0], 403)
        st, _, ck = self.req("POST", "/api/auth/logout", {}, cookie=ca); self.assertEqual(st, 200)
        self.assertEqual(self.req("GET", "/api/auth/me", cookie=ca)[1]["user"], None)
        self.assertEqual(self.req("POST", "/api/auth/delete", {"password": "x"}, cookie=cb)[0], 403)
        self.assertEqual(self.req("POST", "/api/auth/delete", {"password": "correct horse battery"}, cookie=cb)[0], 200)
if __name__ == "__main__": unittest.main()
