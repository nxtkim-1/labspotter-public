import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import bench_session as B
def test_notes():
    runs = tempfile.mkdtemp(prefix="ls_notes_"); sid = B.create_session(runs, "t")["session_id"]
    for bad in (("nope", "x"), ("observation", "   ")):
        try: B.add_note(runs, sid, *bad); assert False
        except B.BenchError as e: assert e.code == 400
    try: B.add_note(runs, "0" * 12, "question", "q"); assert False
    except B.BenchError as e: assert e.code == 404
    a = B.add_note(runs, sid, "observation", "tube looked cloudy " * 60)
    q = B.add_note(runs, sid, "question", "why Stir?")
    c = B.add_note(runs, sid, "learner_confirmed", "Step 1: measure 50 mL water")
    assert a["checkpoint"]["status"] == "unconfirmed" and len(a["checkpoint"]["notes"][0]) < 600
    assert c["checkpoint"]["evidence"][0]["kind"] == "user_learner_confirmed" and c["safety_clearance"] is False
    info = B.session_info(runs, sid); assert [x["step"] for x in info["checkpoints"]] == [1, 2, 3]
    assert all(x["status"] == "unconfirmed" and x["t"] > 0 for x in info["checkpoints"])
    assert q["checkpoint"]["notes"][0].startswith("QUESTION")
    print("notes ok")
if __name__ == "__main__": test_notes()
