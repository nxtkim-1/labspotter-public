import sys; sys.path.insert(0,"chain")
import agent_entry as A, facts_schema as FS
def F(c,st="unvalidated_model_claim"): return {"claim":c,"t_start":0,"t_end":4,"model":"m","score":.99,"status":st,"mapping":"native"}
H="Holding [something] over [something]"
def test_agent_overclaim_is_caught_and_gate_wins():
    ans={"steps":[{"step":"hold pipette over tube","status":"COMPLETED","cited_times":[44],"explanation":""}],"possible_mistakes":[]}
    r=A.reconcile([F(H)],ans); assert r[0]["overclaim"] and r[0]["final"]=="UNVERIFIED"
def test_missing_agent_answer_unverified():
    r=A.reconcile([F(H)],None); assert all(x["final"]=="UNVERIFIED" and x["agent"]=="MISSING" and not x["overclaim"] for x in r)
def test_no_facts_unverified(): assert all(x["final"]=="UNVERIFIED" for x in A.reconcile([],{"steps":[]}))
def test_abstain_unverified(): assert all(x["final"]=="UNVERIFIED" for x in A.reconcile([F(H,"abstain")],None))
def test_validated_registry_only():
    FS.VALIDATED.add(("m",H)); r=A.reconcile([F(H)],None); FS.VALIDATED.clear()
    assert r[0]["final"]=="COMPLETED" and r[1]["final"]=="UNVERIFIED"
def _ledger(tmp, lines):
    import os; p=os.path.join(tmp,"agent_ledger.jsonl")
    if lines is not None: open(p,"w").write(lines)
    A.LEDGERS[:] = [p]; return p
def _refuses(fn):
    try: fn()
    except SystemExit as e: return "refused" in str(e)
    return False
def test_live_ledger_missing_refuses():
    import tempfile; d=tempfile.mkdtemp(); _ledger(d,None); assert _refuses(A.checked_aggregate)
def test_live_ledger_corrupt_refuses():
    import tempfile; d=tempfile.mkdtemp(); _ledger(d,'{"opening_reconciliation":true,"cost_usd":0}\nnot json\n'); assert _refuses(A.checked_aggregate)
def test_live_ledger_without_opening_refuses():
    import tempfile; d=tempfile.mkdtemp(); _ledger(d,'{"cost_usd":0.01}\n'); assert _refuses(A.checked_aggregate)
def test_live_ledger_bad_cost_refuses():
    import tempfile; d=tempfile.mkdtemp(); _ledger(d,'{"opening_reconciliation":true,"cost_usd":0}\n{"cost_usd":-1}\n'); assert _refuses(A.checked_aggregate)
def test_live_ledger_ok_sums():
    import tempfile; d=tempfile.mkdtemp(); _ledger(d,'{"opening_reconciliation":true,"cost_usd":0}\n{"cost_usd":0.25}\n'); assert abs(A.checked_aggregate()-0.25)<1e-9
def test_live_call_refused_without_clearance_even_with_ledger():
    import os,tempfile; d=tempfile.mkdtemp(); _ledger(d,'{"opening_reconciliation":true,"cost_usd":0}\n'); os.environ.pop("LABSPOTTER_LIVE_CLEARED",None); os.environ["LABSPOTTER_RUNS"]=d
    assert _refuses(lambda: A.call_meta([], True, "zz"))
