# Owner-authenticated saved-session list and continue (no key). REAL server.py over HTTP, real engine store; SCRIPTED fixture runs, no model.
import os, sys, sqlite3, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_bench_session import _start, _call, _fixture_run, TOK
def test_list_and_continue_owner_session():
    runs = tempfile.mkdtemp(prefix="ls_cont_"); _fixture_run(runs, "clipA")
    p, port = _start(runs)
    try:
        # 1. auth: the list and continue need the owner token like every bench route
        assert _call(port, "GET", "/api/bench/sessions", tok=None)[0] == 401
        assert _call(port, "GET", "/api/bench/sessions", tok="wrong")[0] == 401
        assert _call(port, "POST", "/api/bench/session/%s/continue" % ("0" * 12), tok=None)[0] == 401
        assert _call(port, "GET", "/api/bench/sessions")[1]["sessions"] == []
        import urllib.request, urllib.error
        def raw(path, hdrs, method="GET"):
            r = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=(b"{}" if method == "POST" else None), method=method, headers=dict({"X-LabSpotter-Token": TOK}, **hdrs))
            try: return urllib.request.urlopen(r).status
            except urllib.error.HTTPError as e: return e.code
        assert raw("/api/bench/sessions", {"Host": "evil.example"}) == 403            # Host check
        assert raw("/api/bench/sessions", {"Origin": "https://evil.example"}) == 403   # Origin check
        assert raw("/api/bench/session/%s/continue" % ("0" * 12), {"Origin": "https://evil.example"}, "POST") == 403
        # 2. a saved and frozen session appears, verified, with no key in the response
        s, a = _call(port, "POST", "/api/bench/session", {"name": "t"}); sid = a["session_id"]
        assert _call(port, "POST", "/api/bench/session/%s/continue" % sid)[0] == 400          # no entries yet
        assert _call(port, "POST", "/api/bench/session/%s/claim" % sid, {"run_tag": "clipA"})[0] == 201
        s, fz = _call(port, "POST", "/api/bench/session/%s/freeze" % sid, {"name": "x"}); assert s == 201
        s, lst = _call(port, "GET", "/api/bench/sessions"); assert s == 200
        row = lst["sessions"][0]
        assert row["session_id"] == sid and row["intact"] is True and row["entries"] == 1 and row["frozen"]["unchanged_since_freeze"] is True
        assert fz["token"] not in str(lst) and "token" not in str(lst.keys())
        assert lst["safety_clearance"] is False and lst["bench_state"] == "UNKNOWN"
        # 3. continue without any key: same restored shape and labels as a token resume, never a clearance
        s, c = _call(port, "POST", "/api/bench/session/%s/continue" % sid); assert s == 200
        assert c["record_intact"] is True and c["session_id"] == sid and c["bench_state"] == "UNKNOWN" and c["safety_clearance"] is False
        assert c["checkpoint"]["status"] == "unconfirmed"
        # the portable token path still works and still needs the owner token
        assert _call(port, "POST", "/api/bench/resume", {"token": fz["token"]}, tok=None)[0] == 401
        assert _call(port, "POST", "/api/bench/resume", {"token": fz["token"]})[1]["record_intact"] is True
        # 4. entries after the freeze are reported, the frozen checkpoint is still unchanged
        assert _call(port, "POST", "/api/bench/session/%s/note" % sid, {"kind": "observation", "text": "after"})[0] == 201
        row = _call(port, "GET", "/api/bench/sessions")[1]["sessions"][0]
        assert row["entries"] == 2 and row["frozen"]["entries_after_freeze"] == 1 and row["frozen"]["unchanged_since_freeze"] is True
        # 5. isolation and bad input
        assert _call(port, "POST", "/api/bench/session/%s/continue" % ("a" * 12))[0] == 404
        assert _call(port, "POST", "/api/bench/session/zz/continue")[0] == 404
        # 6. tamper with the stored record: the list marks it not intact and continue is refused (409), the token path too
        p.terminate(); p.wait()
        db = sqlite3.connect(os.path.join(runs, ".bench.sqlite")); cols = [r[1] for r in db.execute("PRAGMA table_info(log)")]
        db.execute("UPDATE log SET payload = replace(payload, 'after', 'EDITED') WHERE run_id=? AND payload LIKE '%after%'", (sid,)); db.commit(); db.close()
        p, port = _start(runs)
        row = _call(port, "GET", "/api/bench/sessions")[1]["sessions"][0]
        assert row["intact"] is False and row["entries"] is None
        assert _call(port, "POST", "/api/bench/session/%s/continue" % sid)[0] == 409
        assert _call(port, "POST", "/api/bench/resume", {"token": fz["token"]})[0] == 409
    finally:
        try: p.kill()
        except Exception: pass
if __name__ == "__main__":
    test_list_and_continue_owner_session(); print("PASS test_bench_continue")
