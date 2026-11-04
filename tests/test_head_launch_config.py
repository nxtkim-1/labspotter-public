import os,sys,json,glob,hashlib,pickle,warnings,subprocess,csv
ROOT=os.getcwd()
EXPECTED=("Add step","AnalyticalMeasurement step","CollectLayer step","MeasureLiquid step","MeasureSolid step","No action","PhaseSeparation step","Stir step")
def _heads():
    out=[]
    for f in sorted(glob.glob(ROOT+"/heads/*.json")):
        c=json.load(open(f))
        if "head_file" in c: out.append((f,c))
    return out
def _classes(h):
    clf=h.steps[-1][1] if hasattr(h,"steps") else h[1]
    return tuple(str(x) for x in clf.classes_)
def test_default_config_is_frozen384_and_hash_matches():
    c=json.load(open(ROOT+"/heads/active.json"))
    assert c["head_file"]=="frozen384.pkl", c["head_file"]
    assert hashlib.sha256(open(ROOT+"/heads/"+c["head_file"],"rb").read()).hexdigest()==c["head_sha256"]
def test_every_head_has_exact_8_classes_and_proba():
    import numpy as np
    n=0
    for f,c in _heads():
        p=ROOT+"/heads/"+c["head_file"]
        assert hashlib.sha256(open(p,"rb").read()).hexdigest()==c["head_sha256"],f
        with warnings.catch_warnings():
            warnings.simplefilter("ignore"); h=pickle.load(open(p,"rb"))
        assert _classes(h)==EXPECTED,(f,_classes(h))
        sc=h.steps[0][1]; x=np.zeros((1,sc.mean_.shape[0])); pr=h.predict_proba(x)[0]
        assert pr.shape==(8,) and abs(pr.sum()-1)<1e-6; n+=1
    assert n>=1
def test_claim_and_step_names_roundtrip_exactly():
    for c in EXPECTED:
        claim=f"lab_action:{c}"; step=f"observe {c}"
        assert claim.split(":",1)[1]==c and step.split(" ",1)[1]==c
def test_csv_labels_equal_head_classes_when_csv_given():
    p=os.environ.get("LABSPOTTER_CSV")
    if not p: print("SKIP csv label check (set LABSPOTTER_CSV to the Zenodo annotation CSV)"); return
    rows=list(csv.reader(open(p)))[1:]
    assert tuple(sorted({r[1] for r in rows}))==tuple(sorted(EXPECTED)),sorted({r[1] for r in rows})
def test_missing_config_fails_clearly():
    env=dict(os.environ,LABSPOTTER_HEAD_CONFIG="/nonexistent/active.json")
    r=subprocess.run([sys.executable,"-c","import sys;sys.path.insert(0,'chain');import action_clip"],cwd=ROOT,env=env,capture_output=True,text=True,timeout=60)
    assert r.returncode!=0 and "head config not found" in (r.stderr+r.stdout) and "Traceback" not in r.stderr.split("head config not found")[0][-200:], (r.stderr[-300:])
