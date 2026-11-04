# Backend bounds, retention and recovery tests. No torch, no network, no Meta, no real inference (analyze is never reached with a clip).
import os, sys, json, time, tempfile, threading, importlib.util, http.client, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.getcwd()
_srv = {}
def _load():
    if "m" in _srv: return _srv["m"]
    tmp = tempfile.mkdtemp(prefix="ls_runs_"); os.environ["LABSPOTTER_RUNS"] = tmp; os.environ["LABSPOTTER_TOKEN"] = "unit-test-token"
    spec = importlib.util.spec_from_file_location("ls_server", os.path.join(ROOT, "server.py")); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), m.H); port = httpd.server_address[1]
    m.App.bind, m.App.port, m.App.hosts = "127.0.0.1", port, m.host_table("127.0.0.1", port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start(); _srv.update(m=m, port=port, httpd=httpd, tmp=tmp); return m
def _mk(m, tag, age_days=0, complete=True):
    d = os.path.join(m.RUNS, tag); os.makedirs(d, exist_ok=True)
    if complete:
        for k in ("predictions", "facts", "result"): open(os.path.join(d, k + ".json"), "w").write("{}")
        t = time.time() - age_days * 86400; os.utime(os.path.join(d, "result.json"), (t, t))
def _clear(m):
    for n in os.listdir(m.RUNS): shutil.rmtree(os.path.join(m.RUNS, n), ignore_errors=True)
def _req(method, path, body=None, tok=True, extra=None):
    m = _load(); c = http.client.HTTPConnection("127.0.0.1", _srv["port"], timeout=10); h = {"Host": "127.0.0.1:%d" % _srv["port"]}
    if tok: h["X-LabSpotter-Token"] = "unit-test-token"
    h.update(extra or {}); c.request(method, path, body=body, headers=h); r = c.getresponse(); data = r.read(); c.close(); return r.status, data
def test_prune_dry_run_deletes_nothing():
    m = _load(); _clear(m); _mk(m, "old1", 40); _mk(m, "new1", 1)
    assert m.prune_runs(30, False) == ["old1"] and os.path.isdir(os.path.join(m.RUNS, "old1"))
def test_prune_apply_only_old_complete_runs():
    m = _load(); _clear(m); _mk(m, "old1", 40); _mk(m, "new1", 1); _mk(m, "partial1", complete=False); os.makedirs(os.path.join(m.RUNS, ".staging-abc"))
    assert m.prune_runs(30, True) == ["old1"]
    assert not os.path.exists(os.path.join(m.RUNS, "old1")) and os.path.isdir(os.path.join(m.RUNS, "new1"))
    assert os.path.isdir(os.path.join(m.RUNS, "partial1")) and os.path.isdir(os.path.join(m.RUNS, ".staging-abc"))
def test_prune_never_follows_symlink():
    m = _load(); _clear(m); outside = tempfile.mkdtemp(prefix="ls_outside_"); open(os.path.join(outside, "keep.txt"), "w").write("x")
    for k in ("predictions", "result"): open(os.path.join(outside, k + ".json"), "w").write("{}")
    os.symlink(outside, os.path.join(m.RUNS, "linked")); assert m.prune_runs(0, True, now=time.time() + 99999) == [] and os.path.exists(os.path.join(outside, "keep.txt"))
def test_store_full_returns_507_before_any_work():
    m = _load(); _clear(m); old = m.MAX_RUNS; m.MAX_RUNS = 1; _mk(m, "a1", 0)
    try:
        st, d = _req("POST", "/api/analyze?tag=newtag", body=b"x" * 10); assert st == 507, (st, d)
    finally: m.MAX_RUNS = old
def test_no_token_is_401_on_runs_and_analyze():
    _load(); assert _req("GET", "/api/runs/x1", tok=False)[0] == 401 and _req("POST", "/api/analyze?tag=t1", body=b"x", tok=False)[0] == 401
def test_missing_partial_and_corrupt_runs():
    m = _load(); _clear(m); _mk(m, "part1", complete=False)
    assert _req("GET", "/api/runs/nothere")[0] == 404 and _req("GET", "/api/runs/part1")[0] == 404
    _mk(m, "bad1"); open(os.path.join(m.RUNS, "bad1", "predictions.json"), "w").write("{not json")
    assert _req("GET", "/api/runs/bad1")[0] == 500
    _mk(m, "ok1"); assert _req("GET", "/api/runs/ok1")[0] == 200
def test_duplicate_tag_409_and_bad_tag_400_and_bad_length_400():
    m = _load(); _clear(m); _mk(m, "dup1")
    assert _req("POST", "/api/analyze?tag=dup1", body=b"xx")[0] == 409
    assert _req("POST", "/api/analyze?tag=../x", body=b"xx")[0] == 400
    assert _req("POST", "/api/analyze?tag=fine1", body=b"", extra={"Content-Length": "0"})[0] == 400
def test_wrong_host_rejected():
    _load(); assert _req("GET", "/api/runs/x1", extra={"Host": "evil.example"})[0] in (400, 403)
