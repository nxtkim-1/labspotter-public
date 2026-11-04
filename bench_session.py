"""BenchFreeze session layer for the classifier app (private build, unvalidated).

What this is: a save/resume record of the run, built on the BenchFreeze engine (hash-chained store + freeze tokens,
engine/ vendored verbatim from feat/lab-action-detector).
What this is NOT: a bench-state check. A clip-level prediction is a model-predicted action claim. It cannot show tube
identity, stock, volume, spatial presence or protocol completion, so the checkpoint written here carries NO tube states,
is always status "unconfirmed" (never "committed"), and cites the clip run as evidence. Resume only proves the saved
record is intact. With no real bench readings the bench state is reported UNKNOWN and safety_clearance is False.
"""
import json, os, re, secrets, threading, time
from engine.store import Store
from engine.freeze import freeze as _freeze, resume as _resume, FreezeError
from engine.schema import Checkpoint, ChainError, SchemaError

SID_RE = re.compile(r"[0-9a-f]{12}")
LABELS = {"bench_state": "UNKNOWN", "bench_readings": "none (no sensor or camera readings in this build)",
          "safety_clearance": False,
          "meaning": "Resume restores the saved record only. It does not show the bench is unchanged or safe."}
_L = threading.Lock()

class BenchError(Exception):
    def __init__(self, code, msg): super().__init__(msg); self.code = code; self.msg = msg

def _store(runs):
    return Store(os.path.join(runs, ".bench.sqlite"))

def _top1(runs, tag):
    fp = os.path.join(runs, tag, "predictions.json")
    if not os.path.isfile(fp): raise BenchError(404, "no completed run with that tag")
    try:
        preds = json.load(open(fp)); p = preds[0] if isinstance(preds, list) else preds["predictions"][0]
        probs = p["probs"]; lab = max(probs, key=probs.get); return lab, float(probs[lab])
    except Exception: raise BenchError(500, "run predictions are unreadable")

def _summary(cp):
    return {"id": cp.id, "step": cp.step, "status": cp.status, "hash": cp.hash, "t": cp.t, "tubes": len(cp.tubes),
            "notes": [n.text for n in cp.notes], "evidence": [{"kind": e.kind, "path": e.path} for e in cp.evidence]}

def create_session(runs, name):
    sid = secrets.token_hex(6)
    with _L:
        s = _store(runs)
        try: s.create_run(sid, "classifier_session", time.time())
        finally: s.close()
    return {"session_id": sid, "name": name, **LABELS}

def add_claim(runs, sid, tag):
    if not SID_RE.fullmatch(sid): raise BenchError(400, "invalid session id")
    lab, p = _top1(runs, tag)
    with _L:
        s = _store(runs)
        try:
            try: run = s.load_run(sid)
            except KeyError: raise BenchError(404, "unknown session")
            n = len(run.branch("main")) + 1
            cp = Checkpoint.from_dict({
                "id": f"{sid}-c{n:03d}", "run_id": sid, "parent_id": None, "branch": "main", "step": n,
                "status": "unconfirmed", "tubes": [], "speaker": None, "t": time.time(), "prev_hash": None, "hash": None,
                "notes": [{"t": 0.0, "text": f"UNVALIDATED model-predicted action claim: {lab} (p={p:.3f}) from clip run {tag}. Not a bench-state reading.",
                           "tube": None, "speaker": None, "contradicts_video": False}],
                "evidence": [{"kind": "clip_run", "t": 0.0, "path": tag}]})
            sealed = s.commit_checkpoint(cp)
        finally: s.close()
    return {"session_id": sid, "checkpoint": _summary(sealed), **LABELS}

NOTE_KINDS = {"spoken_observation": "OBSERVATION spoken by the user, transcribed by Meta and saved by the user (unconfirmed)", "observation": "OBSERVATION typed by the user (unverified)", "question": "QUESTION typed by the user",
              "protocol_loaded": "PROTOCOL loaded by the user (not a validated lab procedure)",
              "label_agreed": "LABEL AGREED by the user (their own tap): the user agrees the clip shows the action named below. This is about the observed action only; it does not say any protocol step was done and the classifier did not verify it",
              "label_corrected": "LABEL CORRECTED by the user (their own tap): the user says the clip shows a different action than the model suggested. The model suggestion stays in the record and is not overwritten; this is not a protocol step and the classifier did not verify it",
              "learner_confirmed": "STEP CONFIRMED by the learner's own tap (not verified by the classifier or any bench reading)"}

def add_note(runs, sid, kind, text):
    """User-typed or learner-tapped entries. Same hash-chained session, always status 'unconfirmed', evidence kind marks the author.
    Never created from a classifier output."""
    if not SID_RE.fullmatch(sid): raise BenchError(400, "invalid session id")
    if kind not in NOTE_KINDS: raise BenchError(400, "unknown entry kind")
    text = " ".join(str(text).split())[:(1600 if kind == "protocol_loaded" else 500)]
    if not text: raise BenchError(400, "entry text is required")
    with _L:
        s = _store(runs)
        try:
            try: run = s.load_run(sid)
            except KeyError: raise BenchError(404, "unknown session")
            except ChainError as e: raise BenchError(409, "saved record failed its integrity check: " + str(e)[:120])
            n = len(run.branch("main")) + 1
            cp = Checkpoint.from_dict({
                "id": f"{sid}-c{n:03d}", "run_id": sid, "parent_id": None, "branch": "main", "step": n,
                "status": "unconfirmed", "tubes": [], "speaker": "user", "t": time.time(), "prev_hash": None, "hash": None,
                "notes": [{"t": 0.0, "text": NOTE_KINDS[kind] + ": " + text, "tube": None, "speaker": "user", "contradicts_video": False}],
                "evidence": [{"kind": "user_" + kind, "t": 0.0, "path": "meta_transcribed_user_saved" if kind == "spoken_observation" else "typed"}]})
            sealed = s.commit_checkpoint(cp)
        finally: s.close()
    return {"session_id": sid, "checkpoint": _summary(sealed), **LABELS}

def add_label(runs, sid, tag, decision, label):
    """User agrees with, or corrects, the model's suggested action label for one clip run. Append-only (a later entry never edits an earlier one).
    Records the model's own top-1 next to the user's label. Not a protocol-step confirmation."""
    if decision not in ("agreed", "corrected"): raise BenchError(400, "decision must be agreed or corrected")
    fp = os.path.join(runs, tag, "predictions.json")
    mlab, _p = _top1(runs, tag)
    preds = json.load(open(fp)); pr = preds[0] if isinstance(preds, list) else preds["predictions"][0]
    if label not in pr["probs"]: raise BenchError(400, "label is not one of this model's action classes")
    if decision == "agreed" and label != mlab: raise BenchError(400, "agreeing means the label equals the model suggestion")
    if decision == "corrected" and label == mlab: raise BenchError(400, "a correction must name a different action")
    return add_note(runs, sid, "label_" + decision, f"clip run {tag}: model suggested {mlab}; user label {label}")

def session_info(runs, sid):
    if not SID_RE.fullmatch(sid): raise BenchError(400, "invalid session id")
    s = _store(runs)
    try:
        try: run = s.load_run(sid)
        except KeyError: raise BenchError(404, "unknown session")
        except ChainError as e: raise BenchError(409, "saved record failed its integrity check: " + str(e)[:120])
        return {"session_id": sid, "checkpoints": [_summary(c) for c in run.branch("main")], **LABELS}
    finally: s.close()

def freeze_session(runs, sid, name):
    if not SID_RE.fullmatch(sid): raise BenchError(400, "invalid session id")
    with _L:
        s = _store(runs)
        try:
            try: r = _freeze(s, sid, name)
            except KeyError: raise BenchError(404, "unknown session")
            except ChainError as e: raise BenchError(409, "saved record failed its integrity check: " + str(e)[:120])
            except FreezeError as e: raise BenchError(400, str(e))
            cp = next(c for c in s.load_run(sid).checkpoints if c.id == r["checkpoint_id"])
        finally: s.close()
    return {"token": r["token"], "session_id": sid, "checkpoint": _summary(cp),
            "frozen_status_note": "Frozen as UNCONFIRMED: a saved model-predicted claim, not a verified step.", **LABELS}

def resume_token(runs, token):
    with _L:
        s = _store(runs)
        try:
            try: cp = _resume(s, token)
            except FreezeError as e: raise BenchError(400, str(e))
            except (ChainError, KeyError) as e: raise BenchError(409, "saved record failed its integrity check: " + str(e)[:120])
        finally: s.close()
    return {"session_id": cp.run_id, "checkpoint": _summary(cp), "record_intact": True, **LABELS}

def _freeze_rows(s, sid):
    """Freeze records for a session, newest first (hashes only: the engine never stores a raw token)."""
    from engine.freeze import _tables
    _tables(s)
    return s.db.execute("SELECT checkpoint_id, checkpoint_hash, created FROM freezes WHERE run_id=? ORDER BY created DESC", (sid,)).fetchall()

def _session_state(s, sid):
    """Verify the session's hash chain, then compare the newest freeze with the stored chain. Returns (run, state dict)."""
    run = s.load_run(sid)                      # verifies the whole chain (and the recorded head) first
    cps = run.branch("main")
    frz = _freeze_rows(s, sid)
    frozen = None
    if frz:
        cid, chash, ts = frz[0]
        cp = next((c for c in run.checkpoints if c.id == cid), None)
        frozen = {"checkpoint_id": cid, "unchanged_since_freeze": bool(cp is not None and cp.hash == chash),
                  "entries_after_freeze": len([c for c in cps if cp is not None and c.step > cp.step]) if cp is not None else None}
    return run, {"entries": len(cps), "last_t": cps[-1].t if cps else None, "frozen": frozen}

def list_sessions(runs):
    """Owner-authenticated list of saved sessions in this backend. Each row is verified; a row that fails its integrity
    check is listed as not intact and cannot be continued. No keys or tokens are returned (none are stored)."""
    out = []
    with _L:
        s = _store(runs)
        try:
            rows = s.db.execute("SELECT run_id, created FROM runs WHERE protocol='classifier_session' ORDER BY created DESC").fetchall()
            for sid, created in rows[:50]:
                if not SID_RE.fullmatch(sid): continue
                try:
                    _, st = _session_state(s, sid)
                    out.append({"session_id": sid, "created": created, "intact": True, **st})
                except (ChainError, KeyError, SchemaError) as e:
                    out.append({"session_id": sid, "created": created, "intact": False, "entries": None, "last_t": None, "frozen": None})
        finally: s.close()
    return {"sessions": out, **LABELS}

def continue_session(runs, sid):
    """Owner-authenticated continue: re-verifies the saved record and the freeze hash, same result shape as a token resume."""
    if not SID_RE.fullmatch(sid): raise BenchError(400, "invalid session id")
    with _L:
        s = _store(runs)
        try:
            try: run, st = _session_state(s, sid)
            except KeyError: raise BenchError(404, "unknown session")
            except (ChainError, SchemaError) as e: raise BenchError(409, "saved record failed its integrity check: " + str(e)[:120])
            if st["frozen"] is not None and not st["frozen"]["unchanged_since_freeze"]:
                raise BenchError(409, "the frozen checkpoint is missing or changed since the freeze")
            cps = run.branch("main")
            if not cps: raise BenchError(400, "this session has no saved entries yet")
            cp = cps[-1]
        finally: s.close()
    return {"session_id": sid, "checkpoint": _summary(cp), "record_intact": True, "via": "owner session (no key)", **LABELS}
