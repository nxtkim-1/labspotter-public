"""Local LabSpotter backend (stdlib only). python3 server.py [--port 8765] [--host 127.0.0.1]
GET  /api/health                      -> minimal readiness, open; full head/encoder/deps detail only with the session token
POST /api/analyze?tag=<name>          -> body = one clip (mp4 bytes, 4 s / 16 frames at 4 fps); {predictions, result}  [token required]
                                         staged into a hidden unique dir and published by atomic rename only after all three
                                         artifacts exist and parse; 409 if the tag already exists - runs are never overwritten;
                                         400 invalid tag / Content-Length; 422 file is not decodable video; 408 stalled upload; 500 incomplete/unreadable artifacts
GET  /api/runs/<tag>                  -> stored predictions/facts/result for a past run  [token required]; 404 until result.json + predictions.json both exist (completion marker); 500 unreadable run data
POST /api/voice/transcribe            -> body = one short 16-bit mono WAV; {transcript, intent}; 503 unless live Meta voice is switched on  [token required]
GET  /api/detections                  -> experimental boxes for the recorded demo clips only  [token required]
Static: gui/dist/* if built; no secret is ever added to served files (index served with Cache-Control: no-store, valid Host + allowed/absent Origin).

Security model:
- Per-launch random session token (LABSPOTTER_TOKEN env or generated; printed only to an interactive terminal, never written to disk, logs, responses or errors). Required as X-LabSpotter-Token on /api/analyze, /api/runs, /api/detections and for full /api/health.
- Host validation: the Host header must name the configured bind address, localhost/127.0.0.1, or (when bound to 0.0.0.0) a real local interface address - all with the configured port. Unknown Host (DNS rebinding) is rejected on every route.
- Origin allowlist derived from those same literal addresses, never from the request's own Host: requests with an Origin outside it get 403 and no CORS headers; ACAO echoes only a matched origin, never *.
- Run tags match [A-Za-z0-9][A-Za-z0-9_-]{0,63} (no dots or separators, so no path traversal); one upload/analysis at a time (503 busy; slot released and tmp/staging cleaned up on every path before the reply is written); 200 MB cap; chunked body read with a socket timeout (LABSPOTTER_READ_TIMEOUT, default 30 s).
- Default bind 127.0.0.1. --host 0.0.0.0 exposes the LAN: the page is fetchable but the API stays locked without the token - use trusted networks only.
Every result is MODEL-PREDICTED and UNVERIFIED; this server never writes an approval. It makes no Meta call unless the operator sets LABSPOTTER_LIVE_CLEARED=1 and MODEL_API_KEY, and then only the fixed Meta routes: speech-to-text POST /api/voice/transcribe (voice_gate.py) and the agent routes POST /api/agent/glimpse and POST /api/agent/coach (agent_entry.py). In hosted mode (LABSPOTTER_HOSTED=1) those voice and agent routes answer 403."""
import json, os, re, sys, time, threading, tempfile, secrets, socket, shutil, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "chain"))
RUNS = os.environ.setdefault("LABSPOTTER_RUNS", os.path.join(os.environ["LABSPOTTER_DATA_DIR"], "runs") if os.environ.get("LABSPOTTER_DATA_DIR") else os.path.join(ROOT, "runs")); os.makedirs(RUNS, exist_ok=True)
LOCK = threading.Lock()
# One upload/analysis at a time: bounds RAM (body buffer <=200 MB + one inference) on the stdlib
# threaded server; extra uploads get a fast 503 instead of piling up in memory.
ANALYZE_SEM = threading.BoundedSemaphore(1)
# Run-store bound (fail-safe, never deletes on its own): once MAX_RUNS completed runs exist, new analyses get 507 until an operator prunes.
# Pruning is explicit: python3 server.py --prune-runs DAYS            (dry run, lists what would go)
#                      python3 server.py --prune-runs DAYS --yes      (deletes completed runs whose result.json is older than DAYS days)
try: MAX_RUNS = int(os.environ.get("LABSPOTTER_MAX_RUNS", "500"))
except ValueError: MAX_RUNS = 500
def list_runs():
    """Completed run dirs (visible tags with result.json + predictions.json). Hidden .staging-* dirs and partial dirs are not counted."""
    out = []
    try: names = sorted(os.listdir(RUNS))
    except OSError: return out
    for n in names:
        d = os.path.join(RUNS, n)
        if n.startswith(".") or not valid_tag(n) or os.path.islink(d) or not os.path.isdir(d): continue
        r = os.path.join(d, "result.json")
        if os.path.isfile(r) and os.path.isfile(os.path.join(d, "predictions.json")): out.append((n, os.path.getmtime(r)))
    return out
def store_full(): return len(list_runs()) >= MAX_RUNS
def prune_runs(days, apply, now=None):
    """Return the tags older than `days`; delete them only when apply is True. Containment-checked, never follows links, never touches staging dirs."""
    import time
    now = time.time() if now is None else now; base = os.path.realpath(RUNS); gone = []
    for n, mt in list_runs():
        if now - mt <= days * 86400: continue
        d = os.path.realpath(os.path.join(RUNS, n))
        if not d.startswith(base + os.sep): continue
        if apply: shutil.rmtree(d)
        gone.append(n)
    return gone
TOKEN = os.environ.get("LABSPOTTER_TOKEN") or secrets.token_urlsafe(24)
# Hosted mode (LABSPOTTER_HOSTED=1): real accounts (auth.py) replace the launch token. Only /api/health, /api/auth/* and
# /api/bench/*, /api/runs*, /api/analyze and /api/detections exist (signed-in, per-user, size and rate limited). Voice and agent routes answer 403 so a public host never spends Meta credit.
HOSTED = os.environ.get("LABSPOTTER_HOSTED") == "1"
PUBLIC_HOST = os.environ.get("LABSPOTTER_PUBLIC_HOST", "").strip().lower()  # e.g. labspotter.onrender.com (hostname only)
if PUBLIC_HOST and not re.fullmatch(r"[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?", PUBLIC_HOST): PUBLIC_HOST = ""
INVITE = os.environ.get("LABSPOTTER_INVITE_CODE", "")
COOKIE = "ls_session"
def _cookie_tok(h):
    for part in (h.headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE: return v
    return ""
def session_user(h):
    if not HOSTED: return None
    import auth
    try: return auth.whoami(RUNS, _cookie_tok(h))
    except Exception: return None
def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("192.0.2.1", 80)); ips.add(s.getsockname()[0]); s.close()
    except Exception: pass
    try: ips.update(ai[4][0] for ai in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except Exception: pass
    return ips
def host_table(bind, port):
    names = {"localhost", "127.0.0.1"}
    if bind not in ("127.0.0.1", "0.0.0.0", ""): names.add(bind)
    if bind == "0.0.0.0": names |= local_ips()
    return {f"{n}:{port}" for n in names}
class App:
    bind = "127.0.0.1"; port = 8765; hosts = host_table("127.0.0.1", 8765)
TAG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
def valid_tag(t): return bool(TAG_RE.fullmatch(t))
class _UploadError(Exception): pass
class _IncompleteRun(Exception): pass
READ_TIMEOUT = int(os.environ.get("LABSPOTTER_READ_TIMEOUT", "30"))
# Total wall-clock bound for one upload: the per-read timeout alone lets a slow-drip client hold the single analysis slot indefinitely.
try: UPLOAD_DEADLINE = float(os.environ.get("LABSPOTTER_UPLOAD_DEADLINE", "300"))
except ValueError: UPLOAD_DEADLINE = 300.0
def authed(h):
    if HOSTED: return session_user(h) is not None
    t = h.headers.get("X-LabSpotter-Token")
    if not t: return False
    try: return secrets.compare_digest(t, TOKEN)
    except TypeError: return False  # non-ASCII header value - simply not the token
def host_ok(h): return h.headers.get("Host", "") in App.hosts or bool(PUBLIC_HOST and h.headers.get("Host", "").lower() == PUBLIC_HOST)
import re as _re
# Optional single extra origin, set at launch only (LABSPOTTER_EXTRA_ORIGIN), for a temporary https tunnel to this
# backend. Exactly one origin of the form https://<name>.trycloudflare.com; anything else is ignored with a warning.
# No wildcard, never taken from a request, never persisted.
_EX = os.environ.get("LABSPOTTER_EXTRA_ORIGIN", "").strip()
EXTRA_ORIGIN = _EX if _re.fullmatch(r"https://[a-z0-9][a-z0-9-]{0,62}\.trycloudflare\.com", _EX) else ""
if _EX and not EXTRA_ORIGIN: print("WARNING: LABSPOTTER_EXTRA_ORIGIN ignored (must be exactly https://<name>.trycloudflare.com)")
def allowed_origin(h):
    o = h.headers.get("Origin")
    if not o: return ""
    return o if (o in {"http://" + x for x in App.hosts} or (EXTRA_ORIGIN and o == EXTRA_ORIGIN) or (PUBLIC_HOST and o == "https://" + PUBLIC_HOST)) else False
def send(h, code, obj, ctype="application/json", ao=None, extra=None):
    b = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
    h.send_response(code); h.send_header("Content-Type", ctype); h.send_header("Content-Length", str(len(b)))
    if ao: h.send_header("Access-Control-Allow-Origin", ao); h.send_header("Vary", "Origin")
    for k, v in (extra or {}).items(): h.send_header(k, v)
    h.end_headers(); h.wfile.write(b)
def gate(h, need_auth):
    if not host_ok(h): send(h, 403, {"error": "unknown host"}); return None
    ao = allowed_origin(h)
    if ao is False: send(h, 403, {"error": "origin not allowed"}); return None
    if need_auth and not authed(h): send(h, 401, {"error": "session token required (printed by the backend at startup)"}, ao=ao); return None
    return ao
def bench_route(h, method, p, ao):
    """BenchFreeze session routes (token + host + origin gated by the caller). See bench_session.py for what a session means."""
    import bench_session as B
    RR = RUNS
    if HOSTED:
        import auth
        RR = os.path.join(auth.user_dir(RUNS, session_user(h)["id"]), "runs"); os.makedirs(RR, exist_ok=True)
    try:
        body = {}
        if method == "POST":
            n = int(h.headers.get("Content-Length", 0) or 0)
            if n < 0 or n > 65536: return send(h, 400, {"error": "JSON body up to 64 KB"}, ao=ao)
            raw = h.rfile.read(n) if n else b"{}"
            try: body = json.loads(raw or b"{}")
            except ValueError: return send(h, 400, {"error": "body must be JSON"}, ao=ao)
            if not isinstance(body, dict): return send(h, 400, {"error": "body must be a JSON object"}, ao=ao)
        def need(k):
            v = body.get(k)
            if not isinstance(v, str) or not v or len(v) > 200: raise B.BenchError(400, "field '" + k + "' (string) is required")
            return v
        m = re.fullmatch(r"/api/bench/session/([0-9a-f]{12})(?:/(claim|freeze|note|continue|label))?", p)
        if p == "/api/bench/projects" and method in ("GET", "POST"): return send(h, 200, B.organization(RR, body if method == "POST" else None), ao=ao)
        if method == "POST" and p == "/api/bench/session" and HOSTED and len(B.list_sessions(RR).get("sessions", [])) >= HOSTED_MAX_SESSIONS: return send(h, 429, {"error": "saved-session limit reached (" + str(HOSTED_MAX_SESSIONS) + ")"}, ao=ao)
        if method == "POST" and p == "/api/bench/session": out = B.create_session(RR, str(body.get("name", ""))[:80]); code = 201
        elif method == "POST" and p == "/api/bench/resume": out = B.resume_token(RR, need("token")); code = 200
        elif m and method == "POST" and m.group(2) == "claim":
            tag = need("run_tag")
            if not valid_tag(tag): raise B.BenchError(400, "invalid run tag")
            out = B.add_claim(RR, m.group(1), tag); code = 201
        elif m and method == "POST" and m.group(2) == "note":
            k = body.get("kind"); t = body.get("text")
            if not isinstance(k, str) or not isinstance(t, str): raise B.BenchError(400, "fields 'kind' and 'text' (strings) are required")
            out = B.add_note(RR, m.group(1), k, t); code = 201
        elif m and method == "POST" and m.group(2) == "label":
            tag = need("run_tag"); d = body.get("decision"); lb = body.get("label")
            if not valid_tag(tag): raise B.BenchError(400, "invalid run tag")
            if not isinstance(d, str) or not isinstance(lb, str): raise B.BenchError(400, "fields 'decision' and 'label' (strings) are required")
            out = B.add_label(RR, m.group(1), tag, d, lb); code = 201
        elif m and method == "POST" and m.group(2) == "freeze": out = B.freeze_session(RR, m.group(1), need("name")); code = 201
        elif m and method == "GET" and not m.group(2): out = B.session_info(RR, m.group(1)); code = 200
        elif method == "GET" and p == "/api/bench/sessions": out = B.list_sessions(RR); code = 200
        elif method == "POST" and m and m.group(2) == "continue": out = B.continue_session(RR, m.group(1)); code = 200
        else: return send(h, 404, {"error": "not found"}, ao=ao)
        return send(h, code, out, ao=ao)
    except B.BenchError as e: return send(h, e.code, {"error": e.msg}, ao=ao)
    except Exception as e:
        sys.stderr.write("bench route failed: " + type(e).__name__ + "\n")
        return send(h, 500, {"error": "bench session failed (" + type(e).__name__ + ")"}, ao=ao)
_RUNS_ROOT = RUNS
def _runs_for(h):
    """Run store for this request: the shared folder on a local run, the signed-in user's own folder when hosted."""
    if not HOSTED: return _RUNS_ROOT
    u = session_user(h)
    if not u:
        return _RUNS_ROOT
    import auth
    return os.path.join(auth.user_dir(_RUNS_ROOT, u["id"]), "runs")
HOSTED_MAX_CLIP = int(os.environ.get("LABSPOTTER_HOSTED_MAX_CLIP", str(25 * 1024 * 1024)))
HOSTED_PER_HOUR = int(os.environ.get("LABSPOTTER_HOSTED_ANALYSES_PER_HOUR", "10"))
HOSTED_USER_BYTES = int(os.environ.get("LABSPOTTER_HOSTED_USER_BYTES", str(200 * 1024 * 1024)))
HOSTED_MAX_SESSIONS = int(os.environ.get("LABSPOTTER_HOSTED_MAX_SESSIONS", "200"))
def _dir_bytes(d):
    t = 0
    for r, _, fs in os.walk(d):
        for f in fs:
            try: t += os.path.getsize(os.path.join(r, f))
            except OSError: pass
    return t
def hosted_quota(runs_dir):
    """Per-user limits on a hosted site: returns an error string or ''."""
    os.makedirs(runs_dir, exist_ok=True)
    now = time.time(); recent = 0
    for n in os.listdir(runs_dir):
        try:
            if now - os.path.getmtime(os.path.join(runs_dir, n)) < 3600: recent += 1
        except OSError: pass
    if recent >= HOSTED_PER_HOUR: return "analysis limit reached (" + str(HOSTED_PER_HOUR) + " clips per hour per account) - try again later"
    if _dir_bytes(runs_dir) >= HOSTED_USER_BYTES: return "your saved-run storage is full (" + str(HOSTED_USER_BYTES // (1024 * 1024)) + " MB) - ask the site owner or delete your account"
    return ""
def auth_route(h, method, p):
    """Hosted-mode account routes. Same-origin only (Origin header must be present and allowed), JSON bodies up to 8 KB."""
    import auth
    ao = gate(h, False)
    if ao is None: return
    def cookie(tok, maxage):
        return {"Set-Cookie": f"{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={maxage}" + ("; Secure" if PUBLIC_HOST else "")}
    ip = h.client_address[0] if h.client_address else ""
    if HOSTED and os.environ.get("LABSPOTTER_TRUST_PROXY") == "1" and h.headers.get("X-Forwarded-For"): ip = h.headers["X-Forwarded-For"].split(",")[0].strip()[:64]
    if not HOSTED: return send(h, 404, {"error": "accounts are only used on a hosted deployment"}, ao=ao)
    try:
        body = {}
        if method == "POST":
            if not h.headers.get("Origin"): return send(h, 403, {"error": "same-origin requests only"}, ao=ao)
            n = int(h.headers.get("Content-Length", 0) or 0)
            if n < 0 or n > 8192: return send(h, 400, {"error": "JSON body up to 8 KB"}, ao=ao)
            try: body = json.loads(h.rfile.read(n) or b"{}")
            except ValueError: return send(h, 400, {"error": "body must be JSON"}, ao=ao)
            if not isinstance(body, dict): return send(h, 400, {"error": "body must be a JSON object"}, ao=ao)
        u = session_user(h)
        if method == "GET" and p == "/api/auth/me": return send(h, 200, {"user": u, "signup": "invite" if INVITE else "open"}, ao=ao)
        if method == "POST" and p == "/api/auth/signup":
            tok, uid = auth.signup(RUNS, body.get("username"), body.get("password"), body.get("invite", ""), ip, INVITE)
            return send(h, 201, {"user": auth.whoami(RUNS, tok)}, ao=ao, extra=cookie(tok, auth.SESSION_TTL))
        if method == "POST" and p == "/api/auth/login":
            tok, uid = auth.login(RUNS, body.get("username"), body.get("password"), ip)
            return send(h, 200, {"user": auth.whoami(RUNS, tok)}, ao=ao, extra=cookie(tok, auth.SESSION_TTL))
        if method == "POST" and p == "/api/auth/logout":
            auth.logout(RUNS, _cookie_tok(h)); return send(h, 200, {"ok": True}, ao=ao, extra=cookie("", 0))
        if not u: return send(h, 401, {"error": "sign in first"}, ao=ao)
        if method == "POST" and p == "/api/auth/password":
            auth.change_password(RUNS, u["id"], body.get("current"), body.get("new")); return send(h, 200, {"ok": True}, ao=ao, extra=cookie("", 0))
        if method == "POST" and p == "/api/auth/delete":
            auth.delete_account(RUNS, u["id"], body.get("password")); return send(h, 200, {"ok": True}, ao=ao, extra=cookie("", 0))
        return send(h, 404, {"error": "unknown route"}, ao=ao)
    except PermissionError as e: return send(h, 403, {"error": str(e)}, ao=ao)
    except ValueError as e: return send(h, 400, {"error": str(e)}, ao=ao)
    except Exception as e:
        sys.stderr.write("auth route failed: " + type(e).__name__ + "\n"); return send(h, 500, {"error": "account request failed"}, ao=ao)
def hosted_block(h, p):
    """In hosted mode only health, accounts, BenchFreeze notes and the signed-in user's own runs/analysis exist under /api/ (voice and agent routes, which can reach Meta, answer 403)."""
    if HOSTED and p.startswith("/api/") and not (p == "/api/health" or p.startswith("/api/auth/") or p.startswith("/api/bench/") or p.startswith("/api/runs") or p == "/api/analyze" or p == "/api/detections" or (p == "/api/voice/transcribe" and os.environ.get("LABSPOTTER_VOICE_CLEARED") == "1" and INVITE)):
        ao = gate(h, False)
        if ao is None: return True
        send(h, 403, {"error": "not available on the hosted site (voice and agent routes are switched off)"}, ao=ao); return True
    return False
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def handle_one_request(self):
        # A client that left before/while we wrote the reply is routine: one short line, no socketserver traceback.
        # Analysis cleanup/publish already ran (the reply is sent last); every other exception propagates as before.
        try: super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError) as e:
            self.close_connection = True
            sys.stderr.write("client disconnected before reply: %s %s (%s)\n" % (getattr(self, "command", None) or "-", (getattr(self, "path", None) or "-").split("?")[0], type(e).__name__))
    def do_OPTIONS(self):
        if not host_ok(self): return send(self, 403, b"")
        ao = allowed_origin(self)
        if not ao: return send(self, 403, b"")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ao); self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-LabSpotter-Token, Content-Type")
        self.send_header("Content-Length", "0"); self.end_headers()
    def do_GET(self):
        RUNS = _runs_for(self)
        p = self.path.split("?")[0]
        if p.startswith("/api/auth/"): return auth_route(self, "GET", p)
        if hosted_block(self, p): return
        if p == "/api/health":
            ao = gate(self, False)
            if ao is None: return
            try: import torch, transformers; dep = {"torch": torch.__version__, "transformers": transformers.__version__, "cuda": torch.cuda.is_available()}; ok = True
            except Exception as e: dep = {"error": repr(e)}; ok = False
            if not authed(self):
                return send(self, 200, {"status": "up", "deps_ok": ok, "auth": "X-LabSpotter-Token required for details and all other /api routes"}, ao=ao)
            try: import action_clip as AC; head, measured, encoder = AC.CFG["label"], AC.CFG["measured"], f"{AC.M}@{AC.REV}"
            except Exception as e: head = measured = "unavailable (deps missing)"; encoder = repr(e)
            return send(self, 200, {"status": "up", "head": head, "measured": measured, "encoder": encoder, "deps": dep, "requires": "torch, transformers, pillow, ffmpeg; ~3 GB RAM; first call downloads ~1.5 GB weights", "status_labels": "model-predicted, unvalidated; no step completed; approval NONE RECORDED", "voice": dict(zip(("available", "reason"), __import__("voice_gate").status()))}, ao=ao)
        if p.startswith("/api/bench/"):
            ao = gate(self, True)
            if ao is None: return
            return bench_route(self, "GET", p, ao)
        m = re.fullmatch(r"/api/runs/([\w.-]+)", p)
        if m:
            ao = gate(self, True)
            if ao is None: return
            tag = m.group(1)
            if not valid_tag(tag): return send(self, 400, {"error": "invalid run tag"}, ao=ao)
            # realpath containment (defense in depth; valid_tag already forbids dots/separators)
            base = os.path.realpath(RUNS); rd = os.path.realpath(os.path.join(RUNS, tag))
            # Completion marker: a run exists only once both files were written; an empty or
            # partial dir (e.g. left by a failed analyze) is 404, never an empty 200.
            if not rd.startswith(base + os.sep) or not (os.path.isfile(os.path.join(rd, "result.json")) and os.path.isfile(os.path.join(rd, "predictions.json"))):
                return send(self, 404, {"error": "no such run"}, ao=ao)
            out = {}
            try:
                for k in ("predictions", "facts", "result"):
                    fp = os.path.join(rd, k + ".json")
                    if os.path.isfile(fp):
                        with open(fp) as fh: out[k] = json.load(fh)
            except Exception:
                return send(self, 500, {"error": "run data unreadable on the backend host"}, ao=ao)
            return send(self, 200, out, ao=ao)
        if p == "/api/detections":
            ao = gate(self, True)
            if ao is None: return
            f = os.path.join(ROOT, "gui", "detections.json"); return send(self, 200 if os.path.exists(f) else 404, open(f, "rb").read() if os.path.exists(f) else {"error": "no detections file"}, ao=ao)
        if p.startswith("/api/"): return send(self, 404, {"error": "not found"})
        if not host_ok(self): return send(self, 403, {"error": "unknown host"})
        ao = allowed_origin(self)
        if ao is False: return send(self, 403, {"error": "origin not allowed"})
        dist = os.path.realpath(os.path.join(ROOT, "gui", "dist"))
        real = os.path.realpath(os.path.join(dist, p.lstrip("/") or "index.html"))
        if (real == dist or real.startswith(dist + os.sep)) and os.path.isfile(real):
            ct = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".png": "image/png"}.get(os.path.splitext(real)[1], "application/octet-stream")
            # Stream in chunks (no whole-file buffering); no secret is ever added to served HTML.
            self.send_response(200); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(os.path.getsize(real)))
            if os.path.basename(real) == "index.html": self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with open(real, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk: break
                    self.wfile.write(chunk)
            return
        send(self, 404, {"error": "not found"})
    def do_POST(self):
        RUNS = _runs_for(self)
        if self.path.split("?")[0].startswith("/api/auth/"): return auth_route(self, "POST", self.path.split("?")[0])
        if hosted_block(self, self.path.split("?")[0]): return
        if self.path.split("?")[0].startswith("/api/bench/"):
            ao = gate(self, True)
            if ao is None: return
            return bench_route(self, "POST", self.path.split("?")[0], ao)
        if self.path.split("?")[0] == "/api/agent/glimpse":
            ao = gate(self, True)
            if ao is None: return
            import agent_entry as A
            if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" or not os.environ.get("MODEL_API_KEY"):
                return send(self, 503, {"error": "agent_unavailable", "message": "The Meta quick look is switched off on this launch."}, ao=ao)
            try: n = int(self.headers.get("Content-Length", "0"))
            except ValueError: n = 0
            if n <= 0 or n > A.GLIMPSE_MAX_BYTES: return send(self, 413, {"error": "segment size outside the allowed range"}, ao=ao)
            raw = self.rfile.read(n)
            mime = "video/mp4" if raw[4:8] == b"ftyp" else ("video/webm" if raw[:4] == b"\x1a\x45\xdf\xa3" else "")
            if not mime: return send(self, 415, {"error": "unsupported video type"}, ao=ao)
            try: txt = A.glimpse(raw, mime, "ui_glimpse")
            except SystemExit as e: return send(self, 503, {"error": "agent_unavailable", "message": str(e)[:200]}, ao=ao)
            except Exception: return send(self, 502, {"error": "agent_failed", "message": "The quick look did not answer."}, ao=ao)
            if not txt: return send(self, 502, {"error": "agent_failed", "message": "The quick look returned nothing."}, ao=ao)
            return send(self, 200, {"text": txt, "model_role": "Meta model quick look: free-form description, not the trained detector, not verified", "approval": "NONE RECORDED"}, ao=ao)
        if self.path.split("?")[0] == "/api/agent/coach":
            ao = gate(self, True)
            if ao is None: return
            import agent_entry as A, bench_session as BS
            sid = (self.path.split("session=", 1) + [""])[1].split("&")[0]
            try: info = BS.session_info(RUNS, sid)
            except BS.BenchError as e: return send(self, e.code, {"error": e.msg}, ao=ao)
            if not info.get("checkpoints"): return send(self, 409, {"error": "empty session", "message": "Save a result or add a note first."}, ao=ao)
            if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" or not os.environ.get("MODEL_API_KEY"):
                return send(self, 503, {"error": "agent_unavailable", "message": "Meta agent is switched off on this launch."}, ao=ao)
            try: ans = A.coach(A.coach_context(info), "ui_coach_" + sid + "_" + str(len(info.get("checkpoints") or [])))
            except SystemExit as e: return send(self, 503, {"error": "agent_unavailable", "message": str(e)[:200]}, ao=ao)
            except Exception: return send(self, 502, {"error": "agent_failed", "message": "The Meta agent did not answer."}, ao=ao)
            if not ans: return send(self, 502, {"error": "agent_failed", "message": "The Meta agent did not return a usable answer."}, ao=ao)
            return send(self, 200, {"recap": str(ans.get("recap", ""))[:600], "open_questions": [str(x)[:240] for x in ans.get("open_questions", [])[:3]], "next_steps": [str(x)[:240] for x in ans.get("next_steps", [])[:3]], "approval": "NONE RECORDED", "note": "Suggestions only, from the text in your session log. Nothing here verifies or completes a step."}, ao=ao)
        if self.path.split("?")[0] == "/api/agent/review":
            ao = gate(self, True)
            if ao is None: return
            import agent_entry as A
            tag = (self.path.split("tag=", 1) + [""])[1].split("&")[0]
            if not valid_tag(tag): return send(self, 400, {"error": "invalid run tag"}, ao=ao)
            fp = os.path.join(RUNS, tag, "facts.json")
            if not os.path.isfile(fp): return send(self, 404, {"error": "no such run"}, ao=ao)
            if os.environ.get("LABSPOTTER_LIVE_CLEARED") != "1" or not os.environ.get("MODEL_API_KEY"):
                return send(self, 503, {"error": "agent_unavailable", "message": "Meta agent is switched off on this launch."}, ao=ao)
            try:
                facts = json.load(open(fp)); ans = A.call_meta([A.FS.agent_view(f) for f in facts], True, "ui_" + tag)
            except SystemExit as e: return send(self, 503, {"error": "agent_unavailable", "message": str(e)[:200]}, ao=ao)
            except Exception: return send(self, 502, {"error": "agent_failed", "message": "The Meta agent did not answer."}, ao=ao)
            return send(self, 200, {"steps": A.reconcile(facts, ans), "agent_possible_mistakes": (ans or {}).get("possible_mistakes"), "approval": "NONE RECORDED", "note": "Claimed presence only. The code gate decides; nothing here approves a step."}, ao=ao)
        if self.path.split("?")[0] == "/api/voice/transcribe":
            ao = gate(self, True)
            if ao is None: return
            if not self.headers.get("Origin"): return send(self, 403, {"error": "Origin is required for voice notes."}, ao=ao)
            import voice_gate as V
            try: n = int(self.headers.get("Content-Length", 0))
            except (TypeError, ValueError): return send(self, 400, {"error": "missing or malformed Content-Length"}, ao=ao)
            if n <= 0 or n > V.MAX_BYTES: return send(self, 400, {"error": "send one short WAV clip as the body (<= 1 MB)"}, ao=ao)
            if not V.status()[0]: return send(self, 503, {"error": "voice_unavailable", "message": V.status()[1]}, ao=ao)
            if os.environ.get("LABSPOTTER_VOICE_CLEARED") == "1":
                u = session_user(self)
                if not u: return send(self, 401, {"error": "Sign in to use voice notes."}, ao=ao)
                if not INVITE: return send(self, 403, {"error": "Voice notes require invite-only accounts."}, ao=ao)
                try:
                    self.connection.settimeout(10)
                    audio = self.rfile.read(n)
                    if len(audio) != n: return send(self, 400, {"error": "Incomplete audio upload."}, ao=ao)
                except (socket.timeout, TimeoutError): return send(self, 408, {"error": "Audio upload timed out."}, ao=ao)
                finally: self.connection.settimeout(None)
                code, out = V.transcribe(audio, account=u["id"], allowance_root=_RUNS_ROOT)
            else: code, out = V.transcribe(self.rfile.read(n))
            if code == 200: out["intent"] = V.intent(out["transcript"])
            return send(self, code, out, ao=ao)
        if not self.path.startswith("/api/analyze"): return send(self, 404, {"error": "not found"})
        ao = gate(self, True)
        if ao is None: return
        tag = (re.search(r"tag=([^&]+)", self.path) or [None, "run"])[1]
        if not valid_tag(tag): return send(self, 400, {"error": "invalid run tag (1-64 chars: letters, digits, dash, underscore; starts with a letter or digit)"}, ao=ao)
        try: n = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError): return send(self, 400, {"error": "missing or malformed Content-Length"}, ao=ao)
        if HOSTED and n > HOSTED_MAX_CLIP: return send(self, 413, {"error": "clip too large for the hosted site (limit " + str(HOSTED_MAX_CLIP // (1024 * 1024)) + " MB)"}, ao=ao)
        if n <= 0 or n > 200_000_000: return send(self, 400, {"error": "send the clip bytes as the body (<=200 MB)"}, ao=ao)
        rundir = os.path.join(RUNS, tag)
        # Never overwrite: any existing entry for the tag (complete, partial or empty) is a 409.
        # This is the fast path; the authoritative check runs again under LOCK at publish time,
        # so a delayed request that passed here can never overwrite or delete another run.
        if os.path.exists(rundir):
            return send(self, 409, {"error": "run tag '" + tag + "' already exists - pick a new tag (or remove runs/" + tag + " on the backend host); existing runs are never overwritten"}, ao=ao)
        if HOSTED:
            qe = hosted_quota(RUNS)
            if qe: return send(self, 429, {"error": qe}, ao=ao)
        elif store_full():
            return send(self, 507, {"error": "run store is full (" + str(MAX_RUNS) + " runs) - an operator can free space with: python3 server.py --prune-runs DAYS --yes"}, ao=ao)
        if not ANALYZE_SEM.acquire(blocking=False):
            return send(self, 503, {"error": "busy - one upload/analysis at a time; retry in a moment"}, ao=ao)
        tmp = None; ok = False
        # Stage into a hidden unique dir (same filesystem as RUNS); publish is an atomic rename.
        # The staging tag is unique to this request, so cleanup below only ever removes THIS
        # request's claim. Staging dirs are unreachable over the API (valid_tag rejects them)
        # and a crash leftover never blocks the logical tag; stale ones are harmless and can be removed manually while every server on this package is stopped (no automatic sweep - it could delete another live server's active staging).
        stagetag = ".staging-" + secrets.token_hex(8)
        staging = os.path.join(RUNS, stagetag)
        try:
            # bounded chunked read with a socket timeout so a stalled upload cannot hold the busy slot
            self.connection.settimeout(READ_TIMEOUT)
            chunks = []; remaining = n; t_end = time.monotonic() + UPLOAD_DEADLINE
            while remaining > 0:
                if time.monotonic() > t_end: raise socket.timeout("upload exceeded the total time limit")
                chunk = self.rfile.read1(min(1 << 16, remaining))  # read1: one raw read, so the total-deadline check runs between reads (read(n) blocks until n bytes arrive)
                if not chunk: raise _UploadError("upload ended before Content-Length bytes arrived")
                chunks.append(chunk); remaining -= len(chunk)
            tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False); tmp.write(b"".join(chunks)); tmp.close()
            import action_clip as AC
            with LOCK: per, res = AC.main(tag, [tmp.name], False, outdir=staging)
            # publish only a complete, parseable run: all three artifacts must exist and load
            for k in ("predictions", "facts", "result"):
                fp = os.path.join(staging, k + ".json")
                if not os.path.isfile(fp): raise _IncompleteRun("backend finished but " + k + ".json is missing - run not published")
                try:
                    with open(fp) as fh: json.load(fh)
                except Exception: raise _IncompleteRun("backend finished but " + k + ".json is unreadable - run not published")
                # the run's records carry the staging tag; rewrite it to the requested tag
                with open(fp) as fh: raw = fh.read()
                with open(fp, "w") as fh: fh.write(raw.replace(stagetag, tag))
            with LOCK:
                dup = os.path.exists(rundir)
                if not dup: os.rename(staging, rundir)  # atomic same-filesystem publish
            if dup: reply = (409, {"error": "run tag '" + tag + "' already exists - pick a new tag (or remove runs/" + tag + " on the backend host); existing runs are never overwritten"})
            else:
                ok = True
                # the in-memory results still carry the staging tag - rewrite for the response
                res = json.loads(json.dumps(res).replace(stagetag, tag))
                per = json.loads(json.dumps(per).replace(stagetag, tag))
                reply = (200, {"predictions": per, "result": res})
        except _UploadError as e: reply = (400, {"error": str(e)})
        except _IncompleteRun as e: reply = (500, {"error": str(e)})
        except (socket.timeout, TimeoutError): reply = (408, {"error": "upload timed out - the connection stalled"})
        except subprocess.TimeoutExpired:
            sys.stderr.write("analyze: ffmpeg decode timed out\n")
            reply = (422, {"error": "decoding that file took too long - send a short mp4 clip"})
        except subprocess.CalledProcessError as e:
            sys.stderr.write("analyze: ffmpeg could not decode upload (exit %s)\n" % e.returncode)
            reply = (422, {"error": "could not decode that file as video - send an mp4 clip (about 4 s) that ffmpeg can read"})
        except SystemExit as e:
            sys.stderr.write("analyze: " + str(e)[:200] + "\n")
            reply = (422, {"error": "no usable video frames found in that file - send an mp4 clip"})
        except Exception as e:
            sys.stderr.write("analyze failed: " + type(e).__name__ + "\n")
            reply = (500, {"error": "analysis failed on the backend host (" + type(e).__name__ + ") - check the server log"})
        finally:
            try: self.connection.settimeout(None)
            except Exception: pass
            ANALYZE_SEM.release()
            if tmp is not None:
                try: os.unlink(tmp.name)
                except OSError: pass
            # Failure paths remove only this request's own staging claim, never the logical tag.
            if not ok:
                try: shutil.rmtree(staging, ignore_errors=True)
                except Exception: pass
        # Reply only after the finally: slot released and tmp/staging cleaned up before the client can see the answer and send its next request.
        return send(self, *reply, ao=ao)
if __name__ == "__main__" and "--prune-runs" in sys.argv:
    days = float(sys.argv[sys.argv.index("--prune-runs") + 1]); yes = "--yes" in sys.argv
    gone = prune_runs(days, yes)
    print(("Deleted " if yes else "Dry run - would delete ") + str(len(gone)) + " completed run(s) older than " + str(days) + " day(s): " + ", ".join(gone) + ("" if yes else "  (add --yes to delete)")); sys.exit(0)
if __name__ == "__main__":
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8765
    host = sys.argv[sys.argv.index("--host") + 1] if "--host" in sys.argv else "127.0.0.1"
    App.bind, App.port, App.hosts = host, port, host_table(host, port)
    if host != "127.0.0.1":
        print(f"WARNING: listening on {host} - anyone who can reach this address and fetch the served page can use the API. Use only on a trusted network (e.g. your home Wi-Fi for the phone route).")
    if sys.stdout.isatty():
        print(f"Session token for manually connected clients (this launch only): {TOKEN}")
    print(f"LabSpotter backend on http://{host}:{port}  (offline agent, unvalidated model claims only)"); ThreadingHTTPServer((host, port), H).serve_forever()
