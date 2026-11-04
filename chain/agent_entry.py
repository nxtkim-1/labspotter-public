"""Entrypoint: clip -> dedicated video model facts (stored/replayed or run) -> Meta agent protocol query -> code gate -> pending_review alert.
Usage: python3 chain/agent_entry.py <facts.json> <model_id> [--live]   (run from the project root)
The Meta agent gets TEXT ONLY (facts + protocol), never video. The code gate (facts_schema.protocol_step_status) is authoritative:
agent says COMPLETED for a step the gate calls UNVERIFIED -> OVERCLAIM recorded, gate wins. Nothing here approves anything."""
import sys, os, json, time, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "chain"))
import facts_schema as FS
LEDGERS = [os.path.join(os.environ.get("LABSPOTTER_RUNS", os.path.join(ROOT, "runs")), "agent_ledger.jsonl")]
MODEL, PI, PO, MAXOUT, CAP = "muse-spark-1.3", 1.25, 4.25, 1500, 10.0
MAXIN_BYTES, MARGIN = 9000, 1000   # whole request body <= 9000 bytes => <= 9000 input tokens (1 token >= 1 byte) + 1000 margin; max reservation = 10000*1.25/1e6 + 1500*4.25/1e6 = $0.018875
# Protocol for the NatureClip development test: step -> the exact model-vocabulary claim that would have to be VALIDATED to support it.
PROTOCOL = [{"step": "hold pipette over tube", "needs_claim": "Holding [something] over [something]"},
            {"step": "dispense sample into tube", "needs_claim": "Putting [something] into [something]"}]
SCHEMA = {"type": "object", "properties": {"steps": {"type": "array", "items": {"type": "object", "properties": {
    "step": {"type": "string"}, "status": {"type": "string", "enum": ["COMPLETED", "UNVERIFIED"]},
    "cited_times": {"type": "array", "items": {"type": "number"}}, "explanation": {"type": "string"}},
    "required": ["step", "status", "cited_times", "explanation"], "additionalProperties": False}},
    "possible_mistakes": {"type": "array", "items": {"type": "string"}}}, "required": ["steps", "possible_mistakes"], "additionalProperties": False}
SYS = ("You are the protocol-tracking agent for a lab video checker. You never see video. You get claims from a separate video classifier. "
       "Each fact has a model label, interval, score and a status. Score is a model probability, not proof. Decide per protocol step whether it is COMPLETED or UNVERIFIED. "
       "Use only the facts given. Answer with JSON matching the schema. No prose.")
def aggregate():
    """Offline/display total. Fail-open on a missing ledger is fine ONLY for the offline path; live calls use checked_aggregate()."""
    return sum(json.loads(l)["cost_usd"] for f in LEDGERS if os.path.exists(f) for l in open(f) if l.strip())
def checked_aggregate():
    """Fail-closed spend total for live calls: every ledger file must exist, parse line by line, carry a numeric cost_usd, and
    contain an explicit opening_reconciliation record (written by a human-approved step, never by this code). Otherwise refuse."""
    tot = 0.0; opened = False
    for f in LEDGERS:
        if not os.path.exists(f): raise SystemExit("live Meta call refused: spend ledger missing (" + os.path.basename(f) + "); a missing ledger is not zero spend")
        for i, l in enumerate(open(f), 1):
            if not l.strip(): continue
            try: r = json.loads(l)
            except Exception: raise SystemExit("live Meta call refused: spend ledger corrupt at line %d" % i)
            if r.get("opening_reconciliation"): opened = True
            c = r.get("cost_usd", 0)
            if not isinstance(c, (int, float)) or isinstance(c, bool) or c < 0: raise SystemExit("live Meta call refused: bad cost_usd at ledger line %d" % i)
            tot += c
    if not opened: raise SystemExit("live Meta call refused: no opening_reconciliation record in the spend ledger")
    return tot
def eff_cap():
    """Active spend ceiling: the code cap, or a lower per-test ceiling from LABSPOTTER_TEST_CEILING_USD (never higher)."""
    try: c = float(os.environ.get("LABSPOTTER_TEST_CEILING_USD", "")) 
    except ValueError: return CAP
    return min(CAP, c) if c > 0 else CAP
def reserved_count(kind):
    """Attempts already reserved in the ledger: kind 'voice' or 'agent'."""
    n = 0
    if os.path.exists(LEDGERS[0]):
        for l in open(LEDGERS[0]):
            try: t = json.loads(l).get("tag", "")
            except Exception: continue
            if t.endswith("_reserved") and (t == "voice_reserved") == (kind == "voice"): n += 1
    return n
def call_meta(views, live, tag, sysmsg=None, payload=None, schema=None):
    rf = os.path.join(os.environ.get("LABSPOTTER_RUNS", os.path.join(ROOT, "runs")), f"agent_resp_{tag}.json")
    if os.path.exists(rf): return json.load(open(rf))["answer"]
    if not live: return None
    if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" or not os.environ.get("MODEL_API_KEY"): raise SystemExit("live Meta call refused: set LABSPOTTER_LIVE_CLEARED=1 and MODEL_API_KEY (and reconcile spend first)")
    txt = payload if payload is not None else json.dumps({"protocol": PROTOCOL, "facts": [{k: v[k] for k in ("claim", "t_start", "t_end", "score", "status")} for v in views]})
    key = os.environ["MODEL_API_KEY"].strip()
    body = {"model": MODEL, "reasoning": {"effort": "low"}, "max_output_tokens": MAXOUT, "text": {"format": {"type": "json_schema", "name": "agent", "schema": schema or SCHEMA, "strict": True}},
            "input": [{"type": "message", "role": "system", "content": [{"type": "input_text", "text": sysmsg or SYS}]}, {"type": "message", "role": "user", "content": [{"type": "input_text", "text": txt}]}]}
    data = json.dumps(body).encode()
    # Conservative upper bound: a token is at least 1 byte, so the WHOLE serialized request (system + protocol + facts + schema)
    # in bytes can never exceed that many input tokens. Plus MARGIN for any provider-side wrapping. Oversize is refused before any call.
    # Whether the provider's own tokenizer is tighter is not assumed here.
    if len(data) > MAXIN_BYTES: raise SystemExit("live Meta call refused: request over the enforced size cap")
    res = (len(data) + MARGIN) * PI / 1e6 + MAXOUT * PO / 1e6   # reserved BEFORE the upstream request
    import fcntl
    lk = open(LEDGERS[0] + ".lock", "a"); fcntl.flock(lk, fcntl.LOCK_EX)   # check+reserve is atomic across voice/agent/processes
    try:
        mx = os.environ.get("LABSPOTTER_AGENT_MAX_CALLS")
        if mx and mx.isdigit() and reserved_count("agent") >= int(mx): raise SystemExit("live Meta call refused: agent call limit for this test reached")
        if checked_aggregate() + res > eff_cap(): raise SystemExit("cap guard")
        with open(LEDGERS[0], "a") as f: f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "model": MODEL, "tag": tag + "_reserved", "cost_usd": round(res, 6), "note": "reserved before upstream call; failures and timeouts stay charged"}) + "\n")
    finally: fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
    req = urllib.request.Request("https://api.meta.ai/v1/responses", data=data, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t0 = time.time()
    try: r = json.loads(urllib.request.urlopen(req, timeout=120).read()); st = 200
    except urllib.error.HTTPError as e: r, st = {"error": e.read().decode()[:300].replace(key, "[KEY]")}, e.code
    except Exception: r, st = {"error": "network"}, 0   # timeout or network error: the reservation stays charged
    u = r.get("usage") or {}; cost = u.get("input_tokens", 0) * PI / 1e6 + u.get("output_tokens", 0) * PO / 1e6
    with open(LEDGERS[0], "a") as f: f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "model": MODEL, "tag": tag, "http": st, "usage": u, "cost_usd": 0, "actual_usd_info_only": round(cost, 6), "latency_s": round(time.time() - t0, 1)}) + "\n")
    try: ans = json.loads([c["text"] for o in r["output"] for c in (o.get("content") or []) if c.get("type") == "output_text"][0])
    except Exception: ans = None
    json.dump({"http": st, "answer": ans, "usage": u}, open(rf, "w")); return ans

GLIMPSE_MAX_BYTES = 400000   # raw segment bytes; base64 inflates ~1.34x, request body stays < 600 KB
GLIMPSE_RES_IN_TOK = 6000    # pessimistic input-token reservation (measured 466-498 for a 5 s 256 px segment)
GLIMPSE_MAXOUT = 1500
GLIMPSE_PROMPT = "Describe in one or two plain sentences what the person's hands are doing in this short lab clip. Say only what is visible. Do not say a step is done or safe."
def glimpse(video_bytes, mime, tag):
    """Quick look by the Meta model at ONE short video segment. Free-form text only. It is NOT the trained V-JEPA detector and never
    marks a protocol step. Same fail-closed ledger, reserve-before-call and cap as call_meta. Returns the text or raises SystemExit."""
    import base64
    if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" or not os.environ.get("MODEL_API_KEY"): raise SystemExit("live Meta call refused: switched off on this launch")
    if not video_bytes or len(video_bytes) > GLIMPSE_MAX_BYTES: raise SystemExit("segment size outside the allowed range")
    if mime not in ("video/mp4", "video/webm"): raise SystemExit("unsupported video type")
    key = os.environ["MODEL_API_KEY"].strip()
    body = {"model": MODEL, "reasoning": {"effort": "low"}, "max_output_tokens": GLIMPSE_MAXOUT,
            "input": [{"type": "message", "role": "user", "content": [{"type": "input_video", "video_url": "data:%s;base64,%s" % (mime, base64.b64encode(video_bytes).decode())}, {"type": "input_text", "text": GLIMPSE_PROMPT}]}]}
    data = json.dumps(body).encode()
    res = GLIMPSE_RES_IN_TOK * PI / 1e6 + GLIMPSE_MAXOUT * PO / 1e6   # reserved BEFORE the upstream request (about $0.014)
    import fcntl
    lk = open(LEDGERS[0] + ".lock", "a"); fcntl.flock(lk, fcntl.LOCK_EX)
    try:
        mx = os.environ.get("LABSPOTTER_GLIMPSE_MAX_CALLS")
        if mx and mx.isdigit() and sum(1 for l in open(LEDGERS[0]) if '"glimpse_reserved"' in l) >= int(mx): raise SystemExit("live Meta call refused: glimpse call limit for this launch reached")
        if checked_aggregate() + res > eff_cap(): raise SystemExit("cap guard")
        with open(LEDGERS[0], "a") as f: f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "model": MODEL, "tag": "glimpse_reserved", "cost_usd": round(res, 6), "note": "reserved before upstream call; failures and timeouts stay charged"}) + "\n")
    finally: fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
    req = urllib.request.Request("https://api.meta.ai/v1/responses", data=data, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t0 = time.time()
    try: r = json.loads(urllib.request.urlopen(req, timeout=60).read()); st = 200
    except urllib.error.HTTPError as e: r, st = {"error": e.read().decode()[:300].replace(key, "[KEY]")}, e.code
    except Exception: r, st = {"error": "network"}, 0
    u = r.get("usage") or {}; cost = u.get("input_tokens", 0) * PI / 1e6 + u.get("output_tokens", 0) * PO / 1e6
    with open(LEDGERS[0], "a") as f: f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "model": MODEL, "tag": tag, "http": st, "usage": u, "cost_usd": 0, "actual_usd_info_only": round(cost, 6), "latency_s": round(time.time() - t0, 1)}) + "\n")
    try: return " ".join(c["text"] for o in r["output"] for c in (o.get("content") or []) if c.get("type") == "output_text").strip()[:500]
    except Exception: return ""
COACH_SYS = ("You help a learner or researcher at a lab bench review their saved session. You never see video. You get the session log as text: model predictions (claimed presence only, "
             "unvalidated), the user's own notes, a loaded protocol if any, and steps the user confirmed. Write a short plain recap (max 60 words), up to 3 open questions the user should answer, "
             "and up to 3 suggested next steps. Use only the text given. Every step of a loaded protocol is written out in the log: never ask the user for facts already in the log. Never say a step is verified or safe, never invent observations, never mark a step done. Answer with JSON matching the schema. No prose.")
COACH_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["recap", "open_questions", "next_steps"],
                "properties": {"recap": {"type": "string"}, "open_questions": {"type": "array", "items": {"type": "string"}}, "next_steps": {"type": "array", "items": {"type": "string"}}}}
def coach_context(info):
    """Plain-text session context from bench_session.session_info(); bounded so the request stays under the byte cap."""
    lines = []
    for c in (info.get("checkpoints") or [])[-12:]:
        kinds = ",".join(sorted({e.get("kind", "") for e in c.get("evidence", [])})) or "none"
        notes = " | ".join(str(n)[:(1600 if "protocol_loaded" in kinds else 300)] for n in c.get("notes", []))
        lines.append("entry: step=%s status=%s evidence=%s t=%s notes=%s" % (str(c.get("step"))[:80], c.get("status"), kinds, c.get("t"), notes))
    return "\n".join(lines)[:4500]
def coach(context_text, tag):
    return call_meta(None, True, tag, sysmsg=COACH_SYS, payload=json.dumps({"session_log": context_text}), schema=COACH_SCHEMA)
def reconcile(facts, agent_answer):
    """Gate is authoritative. Returns per-step final status + overclaim flags. Missing/malformed agent answer -> UNVERIFIED."""
    gate = FS.protocol_step_status(facts, [p["needs_claim"] for p in PROTOCOL]); out = []
    ag = {s["step"]: s for s in (agent_answer or {}).get("steps", [])}
    for p in PROTOCOL:
        g = gate[p["needs_claim"]]; a = ag.get(p["step"], {}).get("status", "MISSING")
        out.append({"step": p["step"], "gate": g, "agent": a, "final": g, "overclaim": a == "COMPLETED" and g != "COMPLETED"})
    return out
def run(facts_path, model_id, live, tag):
    facts = FS.from_vjepa(facts_path, model_id, top_k=3) if "vjepa" in facts_path else json.load(open(facts_path))
    views = [FS.agent_view(f) for f in facts]
    ans = call_meta(views, live, tag); rec = reconcile(facts, ans)
    res = {"tag": tag, "n_facts": len(facts), "agent_possible_mistakes": (ans or {}).get("possible_mistakes"), "steps": rec,
           "any_overclaim": any(r["overclaim"] for r in rec), "approval": "NONE RECORDED", "aggregate_usd": round(aggregate(), 4)}
    json.dump(res, open(f"agent_result_{tag}.json", "w"), indent=1); return res, views
if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2], "--live" in sys.argv, ([a for a in sys.argv[3:] if a!="--live"] or ["t"])[0])[0], indent=1))
