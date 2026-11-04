# Real server.py over HTTP. The recap for pause A and for pause B must differ (regression: the first recap was cached for the whole session).
# The two answers are pre-seeded in the run cache, so no model, no key and no network are used. Fake env values only enable the route.
import os, sys, json, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_bench_session import _start, _call, _fixture_run
def test_second_pause_gets_its_own_recap():
    runs = tempfile.mkdtemp(prefix="coach_ab_"); _fixture_run(runs, "clipA"); _fixture_run(runs, "clipB")
    os.environ["LABSPOTTER_LIVE_CLEARED"] = "1"; os.environ["MODEL_API_KEY"] = "mock-not-real"
    p, port = _start(runs)
    try:
        sid = _call(port, "POST", "/api/bench/session", {"name": "t"})[1]["session_id"]
        def n(): return len(_call(port, "GET", "/api/bench/session/%s" % sid)[1]["checkpoints"])
        def seed(text):
            open(os.path.join(runs, "agent_resp_ui_coach_%s_%d.json" % (sid, n())), "w").write(json.dumps({"answer": {"recap": text, "open_questions": [], "next_steps": []}}))
        _call(port, "POST", "/api/bench/session/%s/claim" % sid, {"run_tag": "clipA"}); _call(port, "POST", "/api/bench/session/%s/freeze" % sid, {"name": "A"})
        seed("RECAP-A"); a = _call(port, "POST", "/api/agent/coach?session=" + sid, {})
        _call(port, "POST", "/api/bench/session/%s/claim" % sid, {"run_tag": "clipB"}); _call(port, "POST", "/api/bench/session/%s/freeze" % sid, {"name": "B"})
        seed("RECAP-B"); b = _call(port, "POST", "/api/agent/coach?session=" + sid, {})
        assert a[0] == 200 and a[1]["recap"] == "RECAP-A", a
        assert b[0] == 200 and b[1]["recap"] == "RECAP-B", b
    finally: p.kill()
