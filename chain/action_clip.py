"""clip -> V-JEPA2 SSv2 encoder -> features h (1024-d mean last_hidden_state) and lg (174-d SSv2 classifier logits of the checkpoint), joined per heads/active.json (shipped: h+lg, 1198-d) -> head (heads/active.json) -> Facts -> Meta agent (offline unless --live) -> code gate -> pending_review alert.
python3 chain/action_clip.py <tag> [--live] <clip1.mp4> [clip2.mp4 ...]   (each clip = one 4 s / 16-frame window at 4 fps, placed at t=4*i s)
Requires: torch, transformers, pillow, numpy, scikit-learn==1.6.1 (head was pickled with 1.7.2; loads with a warning), ffmpeg on PATH. ~3 GB RAM; CPU ~1 min/clip, GPU faster.
All class claims are 'lab_action:<class>' with status unvalidated_model_claim; VALIDATED stays empty so every step gate stays UNVERIFIED. No approval is ever written."""
import sys, os, json, glob, shutil, subprocess, time, hashlib, pickle, warnings, tempfile
import numpy as np
warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "chain"))
import facts_schema as FS, agent_entry as AE
from engine.store import Store
from engine.schema import Alert, Evidence
M = "facebook/vjepa2-vitl-fpc16-256-ssv2"; REV = "4aa02df8"
CFG_PATH = os.environ.get("LABSPOTTER_HEAD_CONFIG", os.path.join(ROOT, "heads", "active.json"))  # default = frozen384 baseline
def _load_cfg():
    if not os.path.isfile(CFG_PATH):
        raise SystemExit(f"head config not found: {CFG_PATH}. Run from a complete LabSpotter package (it ships heads/active.json and the head pickle it names), or set LABSPOTTER_HEAD_CONFIG to an existing config. Nothing was loaded and no default head is guessed.")
    try: c = json.load(open(CFG_PATH))
    except ValueError as e: raise SystemExit(f"head config {CFG_PATH} is not valid JSON: {e}")
    missing = [k for k in ("head_file", "head_sha256", "label", "measured") if k not in c]
    if missing: raise SystemExit(f"head config {CFG_PATH} is missing keys: {missing}")
    return c
CFG = _load_cfg()
RUNS = os.environ.get("LABSPOTTER_RUNS", os.path.join(ROOT, "runs"))
def load_head():
    p = os.path.join(ROOT, "heads", CFG["head_file"])
    if not os.path.isfile(p): raise SystemExit(f"head file not found: {p} (named by {CFG_PATH}); the package is incomplete")
    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if sha != CFG["head_sha256"]: raise SystemExit(f"head hash mismatch {sha}")
    return pickle.load(open(p, "rb"))
_ENC = {}
def encoder():
    if "m" not in _ENC:
        import torch
        from transformers import AutoVideoProcessor, AutoModelForVideoClassification
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        # Small CPU launches can become much slower from oversubscribed BLAS threads.
        # Bound inference threads by default; operators can explicitly tune for their machine.
        if dev == "cpu":
            try: threads = max(1, min(32, int(os.environ.get("LABSPOTTER_CPU_THREADS", "2"))))
            except ValueError: threads = 2
            torch.set_num_threads(threads)
        _ENC.update(p=AutoVideoProcessor.from_pretrained(M, revision=REV), m=AutoModelForVideoClassification.from_pretrained(M, revision=REV).eval().to(dev), dev=dev)
    return _ENC
def run_ffmpeg(args):
    """ffmpeg with a wall-clock bound (LABSPOTTER_FFMPEG_TIMEOUT, default 60 s); subprocess kills the child on timeout and raises TimeoutExpired."""
    subprocess.check_call(args, timeout=float(os.environ.get("LABSPOTTER_FFMPEG_TIMEOUT", "60")))
def features(clips):
    """returns [(feature dict {'h','lg'}, decoded_frames)] ; frames: ffmpeg fps=4, scale -2:256, first 16 (pads by repeating the last frame; nd reports how many were real)."""
    from PIL import Image
    import torch
    E = encoder(); out = []
    for c in clips:
        fd = tempfile.mkdtemp(prefix="ac_")
        run_ffmpeg(["ffmpeg", "-loglevel", "error", "-y", "-i", c, "-vf", "fps=4,scale=-2:256", "-frames:v", "16", f"{fd}/%03d.png"])
        fr = [np.array(Image.open(f).convert("RGB")) for f in sorted(glob.glob(fd + "/*.png"))]; nd = len(fr); shutil.rmtree(fd, ignore_errors=True)
        if nd == 0: raise SystemExit(f"no frames decoded from {c}")
        if nd < 16: fr += [fr[-1]] * (16 - nd)
        with torch.no_grad():
            lh = E["m"].vjepa2(pixel_values_videos=E["p"](fr, return_tensors="pt")["pixel_values_videos"].to(E["dev"]), skip_predictor=True).last_hidden_state
            h = lh.mean(1)[0].float().cpu().numpy(); lg = E["m"].classifier(E["m"].pooler(lh))[0].float().cpu().numpy()
        out.append(({"h": h, "lg": lg}, nd))
    return out
def predict(head, feats):
    x = np.concatenate([feats[k] for k in CFG["features"]]).astype(np.float32).reshape(1, -1)
    clf = head.steps[-1][1] if hasattr(head, "steps") else head[1]
    p = head.predict_proba(x)[0] if hasattr(head, "predict_proba") else clf.predict_proba(head[0].transform(x))[0]
    return dict(zip([str(c) for c in clf.classes_], map(float, p)))
def main(tag, clips, live, outdir=None):
    head = load_head(); classes = [str(c) for c in (head.steps[-1][1] if hasattr(head, "steps") else head[1]).classes_]
    AE.PROTOCOL = [{"step": f"observe {c}", "needs_claim": f"lab_action:{c}"} for c in classes if c != "No action"]
    model_id = f"{M}@{REV}+{CFG['label'].split(' (')[0].replace(' ', '_')}"
    final_d = os.path.join(RUNS, tag); d = outdir or final_d; os.makedirs(d, exist_ok=True); facts = []; per = []
    for i, (f, nd) in enumerate(features(clips)):
        pr = predict(head, f); tk = sorted(pr.items(), key=lambda kv: -kv[1])[:3]
        per.append({"clip": os.path.basename(clips[i]), "t": 4 * i, "decoded_frames": nd, "top3": [(k, round(v, 3)) for k, v in tk], "probs": {k: round(v, 4) for k, v in pr.items()}})
        facts += [FS.asdict(FS.Fact(f"lab_action:{k}", 4.0 * i, 4.0 * i + 4, model_id, round(v, 3), mapping="native")) for k, v in tk]
    json.dump(per, open(os.path.join(d, "predictions.json"), "w"), indent=1); json.dump(facts, open(os.path.join(d, "facts.json"), "w"), indent=1)
    views = [FS.agent_view(f) for f in facts]; ans = AE.call_meta(views, live, tag); rec = AE.reconcile(facts, ans)
    st = Store(os.path.join(d, "record.db")); rid = f"act-{tag}-{int(time.time())}"; st.create_run(rid, "lab-actions-v0", time.time())
    fp = os.path.join(d, "ev.png"); run_ffmpeg(["ffmpeg", "-v", "error", "-y", "-i", clips[0], "-frames:v", "1", "-vf", "scale=384:-1", fp])
    msg = ("MODEL-PREDICTED, UNVALIDATED lab-action claims (" + CFG["label"] + "; " + CFG["measured"] + "). Not observed actions, no step completed. "
           + "; ".join(f"t={p['t']}s {p['top3'][0][0]} ({p['top3'][0][1]})" for p in per))
    st.add_alert(Alert(id=f"{rid}-a0", run_id=rid, checkpoint_id=None, severity="review", rule="UNVALIDATED_model_claims_only", message=msg, confidence=0.0,
                       evidence=[Evidence(kind="frame", t=0.0, path=os.path.join(final_d, "ev.png"))], blast_radius=[], status="pending_review"))
    st.load_run(rid, expect_head=st.recorded_head(rid))
    res = {"tag": tag, "clips": len(clips), "facts": len(facts), "head": CFG["label"], "head_sha256": CFG["head_sha256"], "steps": rec, "any_overclaim": any(r["overclaim"] for r in rec),
           "alert": f"{rid}-a0 pending_review", "approval": "NONE RECORDED", "meta_agent": "live" if (live and ans) else ("replayed" if ans else "offline (not called)"), "aggregate_usd_in_this_ledger_only": round(AE.aggregate(), 4)}
    json.dump(res, open(os.path.join(d, "result.json"), "w"), indent=1); print(json.dumps(res, indent=1)[:1200]); return per, res
if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if x != "--live"]; main(a[0], a[1:], "--live" in sys.argv)
