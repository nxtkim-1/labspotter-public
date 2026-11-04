"""Offline integration check (no encoder, no network, no Meta call): head reload + feature order + gate + alert store.
Uses stored V-JEPA features: tests/sample_feats.npz (5 IBM TRAIN clips, h and lg). Run: python3 check.py"""
import os, sys, json, numpy as np, tempfile
ROOT = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "chain"))
os.environ["LABSPOTTER_RUNS"] = tempfile.mkdtemp()
import action_clip as AC, facts_schema as FS
z = np.load(os.path.join(ROOT, "tests", "sample_feats.npz")); keys = sorted({k[:-4] for k in z.files if k.endswith("__lg")})
head = AC.load_head(); print("head sha ok:", AC.CFG["head_sha256"][:12], "classes:", len(head.steps[-1][1].classes_))
direct = head.predict_proba(np.stack([np.concatenate([z[k + "__h"], z[k + "__lg"]]) for k in keys]))
ok = True
for i, k in enumerate(keys):
    pr = AC.predict(head, {"h": z[k + "__h"], "lg": z[k + "__lg"]}); v = np.array([pr[str(c)] for c in head.steps[-1][1].classes_])
    ok &= bool(np.allclose(v, direct[i], atol=1e-9))
print("adapter predict == direct head.predict_proba on", len(keys), "clips:", ok)
AC.features = lambda clips: [({"h": z[keys[i % len(keys)] + "__h"], "lg": z[keys[i % len(keys)] + "__lg"]}, 16) for i, _ in enumerate(clips)]   # stub encoder: stored features
import subprocess; clip = os.path.join(ROOT, "tests", "tiny.mp4")
subprocess.check_call(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1:r=4", clip])
per, res = AC.main("check", [clip, clip], False)
assert res["approval"] == "NONE RECORDED" and not res["any_overclaim"] and all(s["final"] == "UNVERIFIED" for s in res["steps"]), res
print("gate: every step UNVERIFIED, overclaims 0, alert pending_review, approval NONE RECORDED  -> PASS" if ok else "FAIL")
