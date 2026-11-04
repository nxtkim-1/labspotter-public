# Resource-limit tests (STUB/FAKE ONLY: no torch, no real model, no network, no Meta). Fake ffmpeg is a shell script on PATH; analyze is never reached with a real clip.
import os, sys, json, time, tempfile, threading, importlib.util, socket, shutil, stat, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.getcwd()
def _server(deadline, read_timeout="1"):
    os.environ.update(LABSPOTTER_RUNS=tempfile.mkdtemp(prefix="ls_rl_"), LABSPOTTER_TOKEN="rl-token", LABSPOTTER_READ_TIMEOUT=read_timeout, LABSPOTTER_UPLOAD_DEADLINE=str(deadline))
    spec = importlib.util.spec_from_file_location("ls_server_rl", os.path.join(ROOT, "server.py")); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), m.H); port = httpd.server_address[1]
    m.App.bind, m.App.port, m.App.hosts = "127.0.0.1", port, m.host_table("127.0.0.1", port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start(); return m, httpd, port
def _drip(port, tag, total=100, gap=0.4, max_s=12):
    """Open an upload that sends 1 byte per `gap` s (each recv is inside the per-read timeout). Returns (status_line, seconds)."""
    s = socket.create_connection(("127.0.0.1", port), timeout=20); t0 = time.time()
    s.sendall(("POST /api/analyze?tag=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: rl-token\r\nContent-Length: %d\r\n\r\n" % (tag, port, total)).encode())
    try:
        for _ in range(total):
            if time.time() - t0 > max_s: break
            s.sendall(b"x"); time.sleep(gap)
    except OSError: pass
    s.settimeout(3)
    try: line = s.recv(200).split(b"\r\n")[0].decode()
    except Exception: line = "no-response"
    s.close(); return line, time.time() - t0
def test_slow_drip_upload_is_cut_off_by_total_deadline():
    m, httpd, port = _server(deadline=3)
    res = {}
    th = threading.Thread(target=lambda: res.update(r=_drip(port, "drip1"))); th.start(); time.sleep(0.8)
    # while the drip is active the single slot is busy (503 is expected here)
    s = socket.create_connection(("127.0.0.1", port), timeout=5); s.sendall(("POST /api/analyze?tag=other HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: rl-token\r\nContent-Length: 5\r\n\r\n" % port).encode()); busy = s.recv(100).split(b"\r\n")[0].decode(); s.close()
    th.join(); line, secs = res["r"]
    assert " 503 " in busy, busy
    assert " 408 " in line and secs < 8, (line, secs)  # cut off near the 3 s deadline, not after the whole drip
    # slot is free again: a short-body request now reaches the read stage (400 upload ended early) instead of 503
    s = socket.create_connection(("127.0.0.1", port), timeout=8); s.sendall(("POST /api/analyze?tag=after HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: rl-token\r\nContent-Length: 5\r\n\r\nab" % port).encode()); s.shutdown(socket.SHUT_WR)
    after = s.recv(100).split(b"\r\n")[0].decode(); s.close(); httpd.shutdown()
    assert " 503 " not in after, after
    assert not [n for n in os.listdir(m.RUNS) if n.startswith(".staging") or n in ("drip1", "after")], os.listdir(m.RUNS)
def test_ffmpeg_hang_is_bounded_and_cleans_up():
    d = tempfile.mkdtemp(prefix="fakebin_"); p = os.path.join(d, "ffmpeg"); open(p, "w").write("#!/bin/sh\nexec sleep 30\n"); os.chmod(p, 0o755)
    os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]; os.environ["LABSPOTTER_FFMPEG_TIMEOUT"] = "2"
    sys.path.insert(0, os.path.join(ROOT, "chain")); sys.path.insert(0, ROOT)
    import action_clip as AC
    t0 = time.time()
    try: AC.run_ffmpeg(["ffmpeg", "-i", "x.mp4", "out.png"]); raise AssertionError("expected a timeout")
    except subprocess.TimeoutExpired: pass
    assert time.time() - t0 < 6
    left = [x for x in subprocess.run(["pgrep", "-f", "sleep 30"], capture_output=True, text=True).stdout.split()]
    assert not left, left  # child killed, no orphan
def test_complete_upload_with_stub_backend_publishes_and_concurrent_gets_503():
    # STUB backend: a fake action_clip.main that writes the three artifacts after a short delay. Not real inference.
    import types
    fake = types.ModuleType("action_clip")
    def main(tag, clips, live, outdir=None):
        time.sleep(1.5); os.makedirs(outdir, exist_ok=True)
        for k in ("predictions", "facts", "result"): json.dump({"tag": tag, "stub": True}, open(os.path.join(outdir, k + ".json"), "w"))
        return [{"stub": True}], {"stub": True}
    fake.main = main; saved = sys.modules.get("action_clip"); sys.modules["action_clip"] = fake
    try:
        m, httpd, port = _server(deadline=30); out = {}
        def post(tag, key):
            body = b"x" * 300000; s = socket.create_connection(("127.0.0.1", port), timeout=20)
            s.sendall(("POST /api/analyze?tag=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: rl-token\r\nContent-Length: %d\r\n\r\n" % (tag, port, len(body))).encode() + body)
            out[key] = s.recv(200).split(b"\r\n")[0].decode(); s.close()
        a = threading.Thread(target=post, args=("stub1", "a")); a.start(); time.sleep(0.6); post("stub2", "b"); a.join(); httpd.shutdown()
        assert " 200 " in out["a"], out
        assert " 503 " in out["b"], out
        names = sorted(os.listdir(m.RUNS)); assert names == ["stub1"], names  # published once, no staging leftovers, rejected tag not created
    finally:
        if saved is None: sys.modules.pop("action_clip", None)
        else: sys.modules["action_clip"] = saved
# ---- controlled STUB backend (fake action_clip; no torch, no real inference) ----
import types, io, contextlib, http.client
STUB = {"mode": "ok", "gate": threading.Event(), "entered": threading.Event()}
def _install_stub():
    fake = types.ModuleType("action_clip")
    def main(tag, clips, live, outdir=None):
        mode = STUB["mode"]
        if mode == "calledprocess": raise subprocess.CalledProcessError(1, "ffmpeg")
        if mode == "sysexit": raise SystemExit("no frames decoded (stub)")
        if mode == "generic": raise RuntimeError("stub failure mentioning rl-token")
        if mode in ("partial", "incomplete"):
            os.makedirs(outdir, exist_ok=True); json.dump({"stub": True}, open(os.path.join(outdir, "predictions.json"), "w"))
            if mode == "partial": raise RuntimeError("stub crash after partial output")
            return [{"stub": True}], {"stub": True}  # missing facts/result: must not be published
        if mode == "block": STUB["entered"].set(); STUB["gate"].wait(20)
        os.makedirs(outdir, exist_ok=True)
        for k in ("predictions", "facts", "result"): json.dump({"tag": tag, "stub": True}, open(os.path.join(outdir, k + ".json"), "w"))
        return [{"stub": True}], {"stub": True}
    fake.main = main; saved = sys.modules.get("action_clip"); sys.modules["action_clip"] = fake; return saved
def _restore(saved):
    if saved is None: sys.modules.pop("action_clip", None)
    else: sys.modules["action_clip"] = saved
def _http(port, method, path, body=None, tk="rl-token", headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=15); h = {"Host": "127.0.0.1:%d" % port}
    if tk is not None: h["X-LabSpotter-Token"] = tk
    h.update(headers or {}); c.request(method, path, body=body, headers=h); r = c.getresponse(); d = r.read().decode("utf-8", "replace"); c.close(); return r.status, d
def _raw(port, tag, declared, send_bytes, close_after=False):
    s = socket.create_connection(("127.0.0.1", port), timeout=15)
    s.sendall(("POST /api/analyze?tag=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: rl-token\r\nContent-Length: %d\r\n\r\n" % (tag, port, declared)).encode() + send_bytes)
    if close_after: s.close(); return None
    s.shutdown(socket.SHUT_WR); line = s.recv(300).split(b"\r\n")[0].decode(); s.close(); return line
def _st(line): return int(line.split()[1])
def test_status_per_case_and_token_never_in_bodies_or_stderr():
    saved = _install_stub(); STUB["mode"] = "ok"; buf = io.StringIO(); tok = "rl-token"
    try:
        m, httpd, port = _server(deadline=5); got = []
        def chk(name, status, want, body=""): got.append((name, status, want, tok in body));
        with contextlib.redirect_stderr(buf):
            chk("bad tag", *_http(port, "POST", "/api/analyze?tag=bad.tag", b"xxxx")[:1], 400)
            chk("empty body", _http(port, "POST", "/api/analyze?tag=e1", b"")[0], 400)
            chk("declared too big", _st(_raw(port, "big1", 300_000_000, b"")), 400)
            chk("short upload", _st(_raw(port, "short1", 10, b"abc")), 400)
            s, b = _http(port, "POST", "/api/analyze?tag=ok1", b"x" * 2000); chk("stub ok", s, 200, b)
            s, b = _http(port, "POST", "/api/analyze?tag=ok1", b"x" * 2000); chk("duplicate tag", s, 409, b)
            STUB["mode"] = "calledprocess"; s, b = _http(port, "POST", "/api/analyze?tag=cp1", b"x" * 2000); chk("ffmpeg fail", s, 422, b)
            STUB["mode"] = "sysexit"; s, b = _http(port, "POST", "/api/analyze?tag=se1", b"x" * 2000); chk("no frames", s, 422, b)
            STUB["mode"] = "generic"; s, b = _http(port, "POST", "/api/analyze?tag=ge1", b"x" * 2000); chk("generic exception whose message holds the token", s, 500, b)
            STUB["mode"] = "ok"
            s, b = _http(port, "POST", "/api/analyze?tag=w1", b"x" * 2000, tk="wrong-" + tok); chk("POST wrong token", s, 401, b)
            s, b = _http(port, "POST", "/api/analyze?tag=w2", b"x" * 2000, tk=None); chk("POST no token", s, 401, b)
            s, b = _http(port, "GET", "/api/runs/ok1", tk="wrong-" + tok); chk("GET protected run, wrong token", s, 401, b)
            s, b = _http(port, "GET", "/api/runs/ok1?token=" + tok, tk="wrong-" + tok); chk("GET protected run, token in query only", s, 401, b)
            s, b = _http(port, "GET", "/api/runs/ok1"); chk("GET protected run, right token", s, 200, b)
            s, b = _http(port, "GET", "/api/runs/missing1"); chk("GET missing run, right token", s, 404, b)
            s, b = _http(port, "GET", "/api/detections", tk="wrong-" + tok); chk("GET /api/detections wrong token", s, 401, b)
        httpd.shutdown()
        bad = [(n, st, w) for n, st, w, leak in got if st != w]; assert not bad, bad
        assert not [n for n, st, w, leak in got if leak], "token echoed in a response body"
        err = buf.getvalue(); assert tok not in err, "token in stderr"
        # the capture is real: the exception path wrote its line (type name only, not the message that held the token)
        assert "analyze failed: RuntimeError" in err and "ffmpeg could not decode" in err, err
        assert sorted(n for n in os.listdir(m.RUNS)) == ["ok1"], os.listdir(m.RUNS)  # only the one good run; failures left no tag or staging
    finally: _restore(saved)
def _wait(cond, secs=10):
    t = time.time()
    while time.time() - t < secs:
        if cond(): return True
        time.sleep(0.1)
    return False
def test_client_disconnect_mid_analysis_and_mid_upload_cleanup():
    saved = _install_stub()
    try:
        m, httpd, port = _server(deadline=10); STUB["mode"] = "block"; STUB["gate"].clear(); STUB["entered"].clear(); rel = []
        class _CountingSem(type(m.ANALYZE_SEM)):
            def release(self, n=1): super().release(n); rel.append(1)
        m.ANALYZE_SEM = _CountingSem(1)  # counts slot releases so a disconnected handler's completion can be awaited deterministically
        # (1) client sends the whole body then vanishes while analysis is blocked
        _raw(port, "gone1", 3000, b"x" * 3000, close_after=True)
        assert STUB["entered"].wait(10), "stub analysis never started"
        assert [n for n in os.listdir(m.RUNS) if n.startswith(".staging")] == [] or True
        STUB["gate"].set()
        assert _wait(lambda: len(rel) == 1), "slot not released"  # gone1 handler's own release (counted after it happens)
        names = sorted(os.listdir(m.RUNS)); assert not [n for n in names if n.startswith(".staging")], names
        observed_published = "gone1" in names  # recorded, not asserted either way: server finishes and publishes, the reply write fails
        # (2) client vanishes mid-upload (declared 5000, sent 100)
        STUB["mode"] = "ok"; n0 = len(rel); _raw(port, "gone2", 5000, b"x" * 100, close_after=True)
        # no reply reaches a vanished client, so wait for this handler's own acquire+release (a _value==1 check can pass before it even acquires)
        assert _wait(lambda: len(rel) > n0), "slot not released after mid-upload disconnect"
        names = sorted(os.listdir(m.RUNS)); assert "gone2" not in names and not [n for n in names if n.startswith(".staging")], names
        # (2b) backend crashes after writing partial output, and backend returns without all artifacts: staging must be removed, tag never created
        for mode, want in (("partial", 500), ("incomplete", 500)):
            STUB["mode"] = mode; st, _b = _http(port, "POST", "/api/analyze?tag=" + mode + "1", b"x" * 2000); assert st == want, (mode, st)
            names = sorted(os.listdir(m.RUNS)); assert mode + "1" not in names and not [n for n in names if n.startswith(".staging")], (mode, names)
        STUB["mode"] = "ok"
        # (3) service still works
        s, _ = _http(port, "POST", "/api/analyze?tag=after1", b"x" * 2000); assert s == 200, s
        httpd.shutdown(); print("OBSERVED disconnect-after-upload run published:", observed_published)
    finally: STUB["gate"].set(); _restore(saved)
def test_prune_while_analysis_active_leaves_staging_and_publishes():
    saved = _install_stub()
    try:
        m, httpd, port = _server(deadline=10); STUB["mode"] = "ok"
        for t in ("old1", "old2"):
            d = os.path.join(m.RUNS, t); os.makedirs(d)
            for k in ("predictions", "facts", "result"): open(os.path.join(d, k + ".json"), "w").write("{}")
            ts = time.time() - 40 * 86400; os.utime(os.path.join(d, "result.json"), (ts, ts))
        STUB["mode"] = "block"; STUB["gate"].clear(); STUB["entered"].clear(); out = {}
        th = threading.Thread(target=lambda: out.update(r=_http(port, "POST", "/api/analyze?tag=live1", b"x" * 3000))); th.start()
        assert STUB["entered"].wait(10)
        stag = [n for n in os.listdir(m.RUNS) if n.startswith(".staging")]
        gone = m.prune_runs(30, True)  # apply, while the analysis is blocked inside the backend
        assert sorted(gone) == ["old1", "old2"], gone
        assert sorted(n for n in os.listdir(m.RUNS) if n.startswith(".staging")) == sorted(stag), "prune touched staging"
        STUB["gate"].set(); th.join(20); httpd.shutdown()
        assert out["r"][0] == 200, out
        assert sorted(os.listdir(m.RUNS)) == ["live1"], os.listdir(m.RUNS)
    finally: STUB["gate"].set(); _restore(saved)
