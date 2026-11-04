# BenchFreeze session tests. REAL: server.py over HTTP in separate OS processes, real engine store/freeze, SIGKILL restart.
# SCRIPTED: the completed run (predictions.json) is a fixture written by the test; no model, no network, no Meta, no sensor.
import os, sys, json, time, signal, socket, sqlite3, tempfile, subprocess, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.getcwd()
TOK = "bench-test-token"
def _port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def _start(runs, tok=TOK):
    port = _port(); env = dict(os.environ, LABSPOTTER_RUNS=runs, LABSPOTTER_TOKEN=tok)
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py"), "--port", str(port)], env=env, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port).read(); return p, port
        except Exception: time.sleep(.2)
    p.kill(); raise AssertionError("server did not start")
def _call(port, method, path, body=None, tok=TOK):
    h = {"X-LabSpotter-Token": tok} if tok else {}
    d = json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None)
    r = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=d, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
def _fixture_run(runs, tag, label="Add_step", p=0.62):
    d = os.path.join(runs, tag); os.makedirs(d)
    json.dump([{"probs": {label: p, "Stir_step": 1 - p}}], open(os.path.join(d, "predictions.json"), "w"))
    json.dump({}, open(os.path.join(d, "result.json"), "w"))
def test_bench_session_end_to_end():
    runs = tempfile.mkdtemp(prefix="ls_bench_"); _fixture_run(runs, "clipA"); _fixture_run(runs, "clipB", "Stir_step", .7)
    p, port = _start(runs)
    try:
        # auth: every bench route needs the token
        assert _call(port, "POST", "/api/bench/session", {}, tok=None)[0] == 401
        assert _call(port, "POST", "/api/bench/session", {}, tok="wrong")[0] == 401
        assert _call(port, "POST", "/api/bench/resume", {"token": "x"}, tok=None)[0] == 401
        s, a = _call(port, "POST", "/api/bench/session", {"name": "t"}); assert s == 201
        s, b = _call(port, "POST", "/api/bench/session", {"name": "t2"}); assert s == 201 and a["session_id"] != b["session_id"]
        for o in (a, b):  # labels: bench state is UNKNOWN, never a clearance
            assert o["bench_state"] == "UNKNOWN" and o["safety_clearance"] is False
        # claim from an unknown run, bad tag, bad session
        assert _call(port, "POST", "/api/bench/session/%s/claim" % a["session_id"], {"run_tag": "nope"})[0] == 404
        assert _call(port, "POST", "/api/bench/session/%s/claim" % a["session_id"], {"run_tag": "../x"})[0] == 400
        assert _call(port, "POST", "/api/bench/session/%s/claim" % ("0" * 12), {"run_tag": "clipA"})[0] == 404
        s, c1 = _call(port, "POST", "/api/bench/session/%s/claim" % a["session_id"], {"run_tag": "clipA"}); assert s == 201
        cp = c1["checkpoint"]; assert cp["status"] == "unconfirmed" and cp["tubes"] == 0 and "UNVALIDATED" in cp["notes"][0]
        s, c2 = _call(port, "POST", "/api/bench/session/%s/claim" % a["session_id"], {"run_tag": "clipB"}); assert s == 201 and c2["checkpoint"]["step"] == 2
        _call(port, "POST", "/api/bench/session/%s/claim" % b["session_id"], {"run_tag": "clipA"})
        s, fz = _call(port, "POST", "/api/bench/session/%s/freeze" % a["session_id"], {"name": "interrupt"})
        assert s == 201 and fz["checkpoint"]["status"] == "unconfirmed" and fz["checkpoint"]["step"] == 2 and "UNCONFIRMED" in fz["frozen_status_note"]
        tok_a = fz["token"]; hash_a = fz["checkpoint"]["hash"]
        assert tok_a.encode() not in open(os.path.join(runs, ".bench.sqlite"), "rb").read()  # token stored only as a hash
        # a session with no checkpoint cannot be frozen
        s, e = _call(port, "POST", "/api/bench/session", {}); assert _call(port, "POST", "/api/bench/session/%s/freeze" % e["session_id"], {"name": "n"})[0] == 400
        # interruption: SIGKILL, then a new server process on the same data
        p.send_signal(signal.SIGKILL); p.wait()
        p, port = _start(runs)
        s, r = _call(port, "POST", "/api/bench/resume", {"token": tok_a})
        assert s == 200 and r["checkpoint"]["hash"] == hash_a and r["session_id"] == a["session_id"] and r["record_intact"] is True
        assert r["bench_state"] == "UNKNOWN" and r["safety_clearance"] is False and r["bench_readings"].startswith("none")
        assert _call(port, "POST", "/api/bench/resume", {"token": "nope"})[0] == 400
        assert _call(port, "POST", "/api/bench/resume", {}, )[0] == 400
        assert _call(port, "POST", "/api/bench/resume", {"token": tok_a}, tok=None)[0] == 401  # token alone is not the session token
        # independent sessions: b has one checkpoint, a has two
        assert len(_call(port, "GET", "/api/bench/session/%s" % b["session_id"])[1]["checkpoints"]) == 1
        assert len(_call(port, "GET", "/api/bench/session/%s" % a["session_id"])[1]["checkpoints"]) == 2
        # stale/tampered: change a saved checkpoint row, then resume and info must refuse (integrity failure)
        p.send_signal(signal.SIGKILL); p.wait()
        db = sqlite3.connect(os.path.join(runs, ".bench.sqlite")); db.row_factory = None
        rows = db.execute("select seq, payload from log where run_id=? and kind='checkpoint' order by seq", (a["session_id"],)).fetchall()
        assert rows; db.execute("update log set payload=? where run_id=? and seq=?", (rows[0][1].replace("clipA", "clipX"), a["session_id"], rows[0][0])); db.commit(); db.close()
        p, port = _start(runs)
        s, t = _call(port, "POST", "/api/bench/resume", {"token": tok_a}); assert s == 409 and "integrity" in t["error"], (s, t)
        assert _call(port, "GET", "/api/bench/session/%s" % a["session_id"])[0] == 409
        assert _call(port, "GET", "/api/bench/session/%s" % b["session_id"])[0] == 200  # other session unaffected
    finally:
        try: p.kill()
        except Exception: pass
if __name__ == "__main__":
    test_bench_session_end_to_end(); print("BENCH SESSION TESTS: PASS")
