"""Voice commands via Meta Model API speech-to-text (Muse Voice Transcribe). Stdlib only.
Spend: same fail-closed ledger/cap guard as chain/agent_entry.py; price $0.18/hour of audio, whole seconds.
Narrow on purpose: one fixed upstream URL, one fixed model, WAV only, short clips, a per-launch call cap.
OFF unless BOTH env vars are set by the operator: LABSPOTTER_LIVE_CLEARED=1 and MODEL_API_KEY. The key is read from the
environment per call, never returned, logged, or sent to the browser. This is not a general API proxy.
Docs: https://dev.meta.ai/docs/api-reference/voice/transcribe (POST /v1/asr/transcribe, multipart: request JSON + audio WAV)."""
import io, json, math, os, struct, sys, threading, time, urllib.request, urllib.error, uuid
URL = "https://api.meta.ai/v1/asr/transcribe"
MODEL = "muse-voice-transcribe-1.0"
MAX_BYTES = 1_000_000            # 16 kHz mono 16-bit is 32 kB/s, so about 30 s
MAX_SECONDS = 30.0
PRICE_PER_HOUR = 0.18   # USD, billed per whole second of audio processed. https://dev.meta.ai/docs/pricing-rate-limits (read 2026-11-03)
KEYWORDS = ["BenchFreeze", "LabSpotter", "freeze", "resume", "analyze", "save result", "start session"]
try: MAX_CALLS = int(os.environ.get("LABSPOTTER_VOICE_MAX_CALLS", "40"))
except ValueError: MAX_CALLS = 40
_LOCK = threading.Lock(); _CALLS = 0

def status():
    """(available, reason). reason is safe to show the user."""
    if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" and os.environ.get("LABSPOTTER_VOICE_CLEARED") != "1": return False, "Voice needs the live Meta API, which is not switched on for this launch."
    if not os.environ.get("MODEL_API_KEY"): return False, "Voice needs a Meta API key in this launch's environment."
    return True, "ready"

def wav_info(b):
    """Validate a PCM WAV and return (seconds, rate, channels, bits) or raise ValueError."""
    if len(b) < 44 or b[:4] != b"RIFF" or b[8:12] != b"WAVE": raise ValueError("not a WAV file")
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(b):
        cid, sz = b[pos:pos+4], struct.unpack("<I", b[pos+4:pos+8])[0]
        if cid == b"fmt " and sz >= 16: fmt = struct.unpack("<HHIIHH", b[pos+8:pos+24])
        elif cid == b"data": data = min(sz, len(b) - pos - 8); break
        pos += 8 + sz + (sz & 1)
    if not fmt or data is None: raise ValueError("WAV is missing fmt or data")
    tag, ch, rate, byterate, _, bits = fmt
    if tag != 1 or bits != 16 or ch != 1: raise ValueError("WAV must be 16-bit PCM mono")
    if rate != 16000 or byterate != 32000 or fmt[4] != 2: raise ValueError("WAV must be 16 kHz PCM mono with a valid byte rate")
    if data <= 0 or data % 2: raise ValueError("Empty or incomplete WAV audio")
    return data / float(byterate), rate, ch, bits

def transcribe(wav, account=None, allowance_root=None):
    """Returns (http_code, json_obj). Never raises; never includes the key."""
    global _CALLS
    ok, why = status()
    if not ok: return 503, {"error": "voice_unavailable", "message": why}
    if len(wav) > MAX_BYTES: return 413, {"error": "audio too large (about 12 s max)"}
    try: secs, rate, _, _ = wav_info(wav)
    except ValueError as e: return 400, {"error": str(e)}
    if secs > MAX_SECONDS: return 400, {"error": "clip longer than %d s" % MAX_SECONDS}
    if os.environ.get("LABSPOTTER_VOICE_CLEARED") == "1":
        try:
            import voice_allowance
            with voice_allowance.reserve(allowance_root or os.environ.get("LABSPOTTER_RUNS", "runs"), account, secs):
                return upstream(wav, secs)
        except PermissionError as e: return 429, {"error": str(e)}
        except Exception: return 503, {"error": "Voice allowance could not be checked."}
    # Same fail-closed guard as chain/agent_entry.py, but RESERVE-BEFORE-CALL: the pessimistic clip cost is appended to the
    # shared ledger under a cross-process lock before the upstream request, so a lost response, timeout or crash is still counted.
    # Check+reserve is atomic (flock on the ledger) so concurrent voice/agent requests share one cap.
    try:
        import fcntl, agent_entry as A
        est = math.ceil(secs) * PRICE_PER_HOUR / 3600.0
        lk = open(A.LEDGERS[0] + ".lock", "a")
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            mx = os.environ.get("LABSPOTTER_VOICE_MAX_CALLS")
            if mx and mx.isdigit() and A.reserved_count("voice") >= int(mx): return 503, {"error": "voice_unavailable", "message": "Voice call limit for this test reached."}
            if A.checked_aggregate() + est > A.eff_cap(): return 503, {"error": "voice_unavailable", "message": "Spend cap guard refused this call."}
            with open(A.LEDGERS[0], "a") as f: f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "model": MODEL, "tag": "voice_reserved", "audio_seconds": math.ceil(secs), "cost_usd": round(est, 6), "note": "reserved before upstream call; failures and timeouts stay charged"}) + "\n")
        finally: fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
    except SystemExit as e: return 503, {"error": "voice_unavailable", "message": str(e)[:200]}
    except Exception as e: return 503, {"error": "voice_unavailable", "message": "Spend guard could not be checked (" + type(e).__name__ + ")."}
    with _LOCK:
        if _CALLS >= MAX_CALLS: return 429, {"error": "voice call cap for this launch reached"}
        _CALLS += 1
    return upstream(wav, secs)

def upstream(wav, secs):
    bnd = uuid.uuid4().hex
    req_json = json.dumps({"model": MODEL, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK", "keywords": KEYWORDS, "languageBias": ["English"]})
    body = (("--%s\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n%s\r\n" % (bnd, req_json)).encode()
            + ("--%s\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.wav\"\r\nContent-Type: audio/wav\r\n\r\n" % bnd).encode()
            + wav + ("\r\n--%s--\r\n" % bnd).encode())
    rq = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + os.environ["MODEL_API_KEY"], "Accept": "application/json",
        "Content-Type": "multipart/form-data; boundary=" + bnd})
    try:
        with urllib.request.urlopen(rq, timeout=20) as r: out = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e: return 502, {"error": "Meta voice API returned HTTP %d" % e.code}
    except Exception as e: return 502, {"error": "Meta voice API call failed (" + type(e).__name__ + ")"}
    text = out.get("transcript") if isinstance(out, dict) else None
    if not isinstance(text, str) and isinstance(out, dict) and isinstance(out.get("turns"), list):
        text = " ".join(str(t.get("transcript", "")) for t in out["turns"] if isinstance(t, dict))
    if not isinstance(text, str): return 502, {"error": "unexpected response shape from Meta voice API"}
    return 200, {"transcript": text[:300], "seconds": round(secs, 1), "model": MODEL}

# Closed command set. Voice only proposes; the page asks for a tap before anything runs, and nothing here can
# approve, acknowledge, clear safety, or supply a resume token (tokens are typed or pasted, never spoken).
INTENTS = [("freeze", ("freeze", "pause the session", "save and freeze")),
           ("save", ("save result", "save the result", "save this", "add to session", "save it")),
           ("start", ("start session", "new session", "start a session", "begin session"))]
def intent(text):
    t = " " + "".join(c.lower() if c.isalnum() else " " for c in text) + " "
    t = " ".join(t.split()); t = " " + t + " "
    for name, keys in INTENTS:
        for k in keys:
            kk = " " + " ".join(k.split()) + " "
            if kk in t: return name
    return None
