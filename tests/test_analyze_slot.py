# Analyze-slot ordering tests (STUB/FAKE action_clip ONLY: no torch, no real model, no network, no Meta).
# The single analyze slot must be released (and tmp/staging cleaned up) BEFORE the reply is written, so a client that
# reads a reply and immediately sends its next POST never gets a spurious 503; a truly concurrent POST still gets 503.
import os, sys, json, time, tempfile, threading, importlib.util, socket, subprocess, types, io, contextlib, http.client
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.getcwd()
def _server():
    os.environ.update(LABSPOTTER_RUNS=tempfile.mkdtemp(prefix="ls_slot_"), LABSPOTTER_TOKEN="slot-token", LABSPOTTER_READ_TIMEOUT="2", LABSPOTTER_UPLOAD_DEADLINE="10")
    spec = importlib.util.spec_from_file_location("ls_server_slot", os.path.join(ROOT, "server.py")); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), m.H); port = httpd.server_address[1]
    m.App.bind, m.App.port, m.App.hosts = "127.0.0.1", port, m.host_table("127.0.0.1", port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start(); return m, httpd, port
STUB = {"mode": "ok", "gate": threading.Event(), "entered": threading.Event()}
def _arts(d, tag):
    os.makedirs(d, exist_ok=True)
    for k in ("predictions", "facts", "result"): json.dump({"tag": tag, "stub": True}, open(os.path.join(d, k + ".json"), "w"))
def _install_stub():
    fake = types.ModuleType("action_clip")
    def main(tag, clips, live, outdir=None):
        mode = STUB["mode"]
        if mode == "calledprocess": raise subprocess.CalledProcessError(1, "ffmpeg")
        if mode == "sysexit": raise SystemExit("no frames decoded (stub)")
        if mode == "generic": raise RuntimeError("stub failure")
        if mode in ("partial", "incomplete"):
            os.makedirs(outdir, exist_ok=True); json.dump({"stub": True}, open(os.path.join(outdir, "predictions.json"), "w"))
            if mode == "partial": raise RuntimeError("stub crash after partial output")
            return [{"stub": True}], {"stub": True}  # missing facts/result: must not be published
        if mode == "dup": _arts(os.path.join(os.path.dirname(outdir), tag), tag)  # another publish of the same tag lands mid-analysis -> 409 under LOCK
        if mode == "block": os.makedirs(outdir, exist_ok=True); STUB["entered"].set(); STUB["gate"].wait(20)
        _arts(outdir, tag); return [{"stub": True}], {"stub": True}
    fake.main = main; saved = sys.modules.get("action_clip"); sys.modules["action_clip"] = fake; return saved
def _restore(saved):
    if saved is None: sys.modules.pop("action_clip", None)
    else: sys.modules["action_clip"] = saved
def _staging(m): return [n for n in os.listdir(m.RUNS) if n.startswith(".staging")]
def _status(port, tag, declared=2000, body=None):
    """Raw POST on a fresh connection; returns the status code as soon as the status line arrives (the handler may still be running)."""
    body = b"x" * declared if body is None else body
    s = socket.create_connection(("127.0.0.1", port), timeout=15)
    s.sendall(("POST /api/analyze?tag=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: slot-token\r\nContent-Length: %d\r\n\r\n" % (tag, port, declared)).encode() + body)
    if len(body) < declared: s.shutdown(socket.SHUT_WR)
    buf = b""
    while b"\r\n" not in buf:
        c = s.recv(200)
        if not c: break
        buf += c
    s.close(); return int(buf.split(b"\r\n")[0].split()[1])
def _status_in_thread(port, tag, **kw):
    r = {}; th = threading.Thread(target=lambda: r.update(v=_status(port, tag, **kw))); th.start(); th.join(20); return r.get("v")
# (tag, stub mode, expected status, extra kwargs) - every case reaches the analyze slot
CASES = [("ok1", "ok", 200, {}), ("dup1", "dup", 409, {}), ("cp1", "calledprocess", 422, {}), ("se1", "sysexit", 422, {}),
         ("ge1", "generic", 500, {}), ("pa1", "partial", 500, {}), ("in1", "incomplete", 500, {}), ("sh1", "ok", 400, {"declared": 10, "body": b"abc"})]
def test_slot_is_free_when_reply_is_sent():
    saved = _install_stub(); buf = io.StringIO()
    try:
        m, httpd, port = _server(); real = m.send; rec = []
        def wrapped(h, code, obj, **kw):
            if h.path.startswith("/api/analyze"): rec.append((h.path, code, m.ANALYZE_SEM._value, _staging(m)))
            return real(h, code, obj, **kw)
        m.send = wrapped
        with contextlib.redirect_stderr(buf):
            for tag, mode, want, kw in CASES: STUB["mode"] = mode; assert _status(port, tag, **kw) == want, (tag, want)
        httpd.shutdown()
        assert [c for _p, c, _v, _s in rec] == [w for _t, _m, w, _k in CASES], rec
        assert all(v == 1 for _p, _c, v, _s in rec), "analyze slot still held while the reply was written: %r" % rec
        assert not [r for r in rec if r[3]], "staging not cleaned up before the reply: %r" % rec
        assert sorted(n for n in os.listdir(m.RUNS)) == ["dup1", "ok1"], os.listdir(m.RUNS)
    finally: _restore(saved)
def test_sequential_back_to_back_posts_get_their_real_status():
    saved = _install_stub(); buf = io.StringIO()
    try:
        m, httpd, port = _server(); real = m.send
        def slow(h, code, obj, **kw):
            r = real(h, code, obj, **kw)
            if h.path.startswith("/api/analyze"): time.sleep(0.3)  # slow reply flush: the reply is already on the wire, the handler is still running
            return r
        m.send = slow
        seq = [("a1", "ok", 200, {}), ("a1", "ok", 409, {}), ("b1", "dup", 409, {}), ("c1", "calledprocess", 422, {}), ("d1", "ok", 200, {}),
               ("e1", "generic", 500, {}), ("f1", "sysexit", 422, {}), ("g1", "partial", 500, {}), ("h1", "incomplete", 500, {}),
               ("i1", "ok", 400, {"declared": 10, "body": b"abc"}), ("j1", "ok", 200, {})]
        got = []
        with contextlib.redirect_stderr(buf):
            for tag, mode, want, kw in seq: STUB["mode"] = mode; got.append((tag, mode, _status_in_thread(port, tag, **kw), want))
        httpd.shutdown()
        assert not [g for g in got if g[2] == 503], "spurious 503 on a sequential POST: %r" % got
        assert all(g[2] == g[3] for g in got), got
    finally: _restore(saved)
def test_truly_concurrent_post_gets_503():
    saved = _install_stub()
    try:
        m, httpd, port = _server(); STUB["mode"] = "block"; STUB["gate"].clear(); STUB["entered"].clear(); out = {}
        def first():
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
            c.request("POST", "/api/analyze?tag=hold1", body=b"x" * 3000, headers={"Host": "127.0.0.1:%d" % port, "X-LabSpotter-Token": "slot-token"})
            r = c.getresponse(); r.read(); out["a"] = r.status; c.close()
        th = threading.Thread(target=first); th.start()
        assert STUB["entered"].wait(10), "stub analysis never started"
        held = _staging(m); assert len(held) == 1, held
        assert _status(port, "over1") == 503
        assert "over1" not in os.listdir(m.RUNS) and _staging(m) == held, os.listdir(m.RUNS)  # the rejected POST left no run and no staging
        STUB["gate"].set(); th.join(20)
        assert out.get("a") == 200, out
        STUB["mode"] = "ok"; assert _status(port, "next1") == 200  # straight after the first reply, no wait helper
        httpd.shutdown()
        assert sorted(os.listdir(m.RUNS)) == ["hold1", "next1"], os.listdir(m.RUNS)
    finally: STUB["gate"].set(); _restore(saved)
if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_") and callable(v): v(); print("PASS", k)
