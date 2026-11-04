import os, sys, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import bench_session as B
def test_labels():
    runs = tempfile.mkdtemp(prefix="ls_lab_"); sid = B.create_session(runs, "t")["session_id"]
    os.makedirs(os.path.join(runs, "r1"))
    json.dump([{"probs": {"Add": 0.1, "Stir": 0.6, "Measure": 0.3}}], open(os.path.join(runs, "r1", "predictions.json"), "w"))
    for bad in (("agreed", "Add"), ("corrected", "Stir"), ("corrected", "Nope"), ("maybe", "Stir")):
        try: B.add_label(runs, sid, "r1", *bad); assert False, bad
        except B.BenchError as e: assert e.code == 400
    a = B.add_label(runs, sid, "r1", "agreed", "Stir")
    c = B.add_label(runs, sid, "r1", "corrected", "Add")
    assert a["checkpoint"]["evidence"][0]["kind"] == "user_label_agreed" and c["checkpoint"]["evidence"][0]["kind"] == "user_label_corrected"
    assert "model suggested Stir; user label Add" in c["checkpoint"]["notes"][0] and "not a protocol step" in c["checkpoint"]["notes"][0]
    assert a["checkpoint"]["status"] == c["checkpoint"]["status"] == "unconfirmed" and c["safety_clearance"] is False
    info = B.session_info(runs, sid); assert len(info["checkpoints"]) == 2
    print("labels ok")
if __name__ == "__main__": test_labels()
