# Client-disconnect logging tests (STUB/FAKE action_clip ONLY: no torch, no real model, no network, no Meta).
# A client that goes away before/while the reply is written (BrokenPipeError / ConnectionResetError) must produce exactly one
# short stderr line, no traceback; the analyze slot is still released, staging cleaned up, and a finished run still published.
import os, sys, json, struct, tempfile, threading, importlib.util, socket, types, io, contextlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.getcwd()
STUB = {"gate": threading.Event(), "entered": threading.Event(), "block": False}
CAPTURED = {}  # test name -> captured server stderr (printed when run standalone)
def _server():
    os.environ.update(LABSPOTTER_RUNS=tempfile.mkdtemp(prefix="ls_disc_"), LABSPOTTER_TOKEN="disc-token", LABSPOTTER_READ_TIMEOUT="5", LABSPOTTER_UPLOAD_DEADLINE="10")
    spec = importlib.util.spec_from_file_location("ls_server_disc", os.path.join(ROOT, "server.py")); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    from http.server import ThreadingHTTPServer
    done = threading.Semaphore(0)
    class S(ThreadingHTTPServer):
        def shutdown_request(self, request):  # runs after the handler (and after socketserver's handle_error, if any) for every connection
            super().shutdown_request(request); done.release()
    httpd = S(("127.0.0.1", 0), m.H); port = httpd.server_address[1]
    m.App.bind, m.App.port, m.App.hosts = "127.0.0.1", port, m.host_table("127.0.0.1", port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start(); return m, httpd, port, done
def _install_stub():
    fake = types.ModuleType("action_clip")
    def main(tag, clips, live, outdir=None):
        os.makedirs(outdir, exist_ok=True)
        if STUB["block"]: STUB["entered"].set(); STUB["gate"].wait(20)
        for k in ("predictions", "facts", "result"): json.dump({"tag": tag, "stub": True}, open(os.path.join(outdir, k + ".json"), "w"))
        return [{"stub": True}], {"stub": True}
    fake.main = main; saved = sys.modules.get("action_clip"); sys.modules["action_clip"] = fake; return saved
def _restore(saved):
    if saved is None: sys.modules.pop("action_clip", None)
    else: sys.modules["action_clip"] = saved
def _staging(m): return [n for n in os.listdir(m.RUNS) if n.startswith(".staging")]
def _rst_close(s):
    s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)); s.close()  # linger 0: close sends RST, not FIN
def _post(port, tag):
    s = socket.create_connection(("127.0.0.1", port), timeout=15); body = b"x" * 2000
    s.sendall(("POST /api/analyze?tag=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-LabSpotter-Token: disc-token\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % (tag, port, len(body))).encode() + body)
    return s
def _status(port, tag):
    s = _post(port, tag); buf = b""
    while b"\r\n" not in buf:
        c = s.recv(200)
        if not c: break
        buf += c
    s.close(); return int(buf.split(b"\r\n")[0].split()[1])
def _check_stderr(err, n_disconnects, what):
    assert "Traceback" not in err, "traceback on stderr:\n" + err
    assert "Exception occurred during processing" not in err, "socketserver error dump on stderr:\n" + err
    lines = [l for l in err.splitlines() if l.startswith("client disconnected")]
    assert len(lines) == n_disconnects, "want %d disconnect line(s), got %d:\n%s" % (n_disconnects, len(lines), err)
    assert all(what in l for l in lines), (what, lines)
def test_post_analyze_client_gone_before_reply():
    saved = _install_stub(); buf = io.StringIO(); CAPTURED["test_post_analyze_client_gone_before_reply"] = buf
    try:
        m, httpd, port, done = _server()
        with contextlib.redirect_stderr(buf):
            for i in range(2):  # two disconnects -> exactly two lines
                STUB["block"] = True; STUB["gate"].clear(); STUB["entered"].clear()
                s = _post(port, "gone%d" % i)
                assert STUB["entered"].wait(10), "stub analysis never started"
                _rst_close(s)                                   # client leaves while analysis runs
                STUB["gate"].set()                              # analysis finishes, server writes the reply to a reset socket
                assert done.acquire(timeout=10), "handler never finished"
            STUB["block"] = False
            assert m.ANALYZE_SEM._value == 1, "analyze slot still held after the client left"
            assert _status(port, "after1") == 200              # next normal POST gets its real status, not 503
            assert done.acquire(timeout=10)
        httpd.shutdown(); httpd.server_close()
        _check_stderr(buf.getvalue(), 2, "POST /api/analyze")
        assert not _staging(m), _staging(m)
        assert sorted(os.listdir(m.RUNS)) == ["after1", "gone0", "gone1"], os.listdir(m.RUNS)  # finished runs are published even though the client left
    finally: STUB["gate"].set(); STUB["block"] = False; _restore(saved)
def test_get_static_file_client_gone_mid_stream():
    buf = io.StringIO(); CAPTURED["test_get_static_file_client_gone_mid_stream"] = buf
    m, httpd, port, done = _server()
    # private gui/dist in a temp dir (the real gui/ is not touched); the file is far larger than the loopback socket buffers,
    # so the server is guaranteed to still be streaming (blocked in write) when the client resets the connection
    fake_root = tempfile.mkdtemp(prefix="ls_disc_root_"); os.makedirs(os.path.join(fake_root, "gui", "dist"))
    with open(os.path.join(fake_root, "gui", "dist", "big.bin"), "wb") as f: f.truncate(256 << 20)
    m.ROOT = fake_root
    try:
        with contextlib.redirect_stderr(buf):
            s = socket.create_connection(("127.0.0.1", port), timeout=15)
            s.sendall(("GET /big.bin HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n" % port).encode())
            first = s.recv(4096); assert first.startswith(b"HTTP/1.0 200") or first.startswith(b"HTTP/1.1 200"), first[:80]
            _rst_close(s)
            assert done.acquire(timeout=20), "handler never finished"
        httpd.shutdown(); httpd.server_close()
        _check_stderr(buf.getvalue(), 1, "GET /big.bin")
    finally: os.unlink(os.path.join(fake_root, "gui", "dist", "big.bin"))
if __name__ == "__main__":
    fails = 0
    for k, v in list(globals().items()):
        if k.startswith("test_") and callable(v):
            try: v(); res = "PASS"
            except Exception as e: res = "FAIL: " + (str(e) or repr(e)); fails += 1
            print("---- captured server stderr (%s) ----\n%s---- end ----" % (k, CAPTURED[k].getvalue() if k in CAPTURED else ""))
            print(("PASS " if res == "PASS" else "FAIL ") + k + ("" if res == "PASS" else "\n" + res))
    sys.exit(1 if fails else 0)
