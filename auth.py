"""LabSpotter accounts for a hosted deployment (stdlib only).
Passwords: hashlib.scrypt with a per-user salt. Sessions: random 32-byte tokens, only their SHA-256 is stored; HttpOnly cookie.
Storage: one SQLite file under the runs directory. On a host with an ephemeral disk, accounts are lost on restart/redeploy; set
LABSPOTTER_RUNS to a persistent disk to keep them. No email, no password recovery, no third-party calls."""
import hashlib, hmac, os, re, secrets, sqlite3, threading, time
USER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,31}")
SESSION_TTL = 14 * 86400
_lock = threading.Lock()
_fails = {}  # (ip, username) -> [timestamps]
def _db(runs):
    c = sqlite3.connect(os.path.join(runs, "_accounts.sqlite"), timeout=10)
    c.execute("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, salt BLOB, hash BLOB, created REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, uid TEXT, expires REAL)")
    return c
def _hash(pw, salt): return hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
def _check_pw(pw):
    if not isinstance(pw, str) or len(pw) < 10 or len(pw) > 200: raise ValueError("password must be 10 to 200 characters")
def _throttled(ip, name, now):
    k = (ip, name.lower()); l = [t for t in _fails.get(k, []) if now - t < 600]; _fails[k] = l
    return len(l) >= 8
def signup(runs, name, pw, invite="", ip="", required_invite=""):
    if required_invite and not hmac.compare_digest(str(invite), required_invite): raise PermissionError("invite code needed")
    if not isinstance(name, str) or not USER_RE.fullmatch(name): raise ValueError("username: 3 to 32 letters, digits, dot, dash or underscore")
    _check_pw(pw)
    salt = secrets.token_bytes(16); uid = secrets.token_hex(8)
    with _lock:
        c = _db(runs)
        try:
            c.execute("INSERT INTO users VALUES(?,?,?,?,?)", (uid, name, salt, _hash(pw, salt), time.time())); c.commit()
        except sqlite3.IntegrityError: raise ValueError("that username is taken")
        finally: c.close()
    return login(runs, name, pw, ip)
def login(runs, name, pw, ip=""):
    now = time.time()
    with _lock:
        if _throttled(ip, str(name), now): raise PermissionError("too many attempts, try again in a few minutes")
        c = _db(runs)
        try:
            r = c.execute("SELECT id, salt, hash FROM users WHERE name=?", (str(name),)).fetchone()
            ok = bool(r) and isinstance(pw, str) and hmac.compare_digest(_hash(pw, r[1]), r[2])
            if not r: _hash("x", b"0" * 16)  # similar timing for unknown names
            if not ok: _fails.setdefault((ip, str(name).lower()), []).append(now); raise PermissionError("wrong username or password")
            tok = secrets.token_urlsafe(32)
            c.execute("DELETE FROM sessions WHERE expires<?", (now,))
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(tok.encode()).hexdigest(), r[0], now + SESSION_TTL)); c.commit()
            return tok, r[0]
        finally: c.close()
def whoami(runs, tok):
    if not tok: return None
    c = _db(runs)
    try:
        r = c.execute("SELECT u.id, u.name, s.expires FROM sessions s JOIN users u ON u.id=s.uid WHERE s.th=?", (hashlib.sha256(tok.encode()).hexdigest(),)).fetchone()
        return {"id": r[0], "name": r[1]} if r and r[2] > time.time() else None
    finally: c.close()
def logout(runs, tok):
    c = _db(runs)
    try: c.execute("DELETE FROM sessions WHERE th=?", (hashlib.sha256((tok or "").encode()).hexdigest(),)); c.commit()
    finally: c.close()
def change_password(runs, uid, old, new):
    _check_pw(new)
    with _lock:
        c = _db(runs)
        try:
            r = c.execute("SELECT salt, hash FROM users WHERE id=?", (uid,)).fetchone()
            if not r or not isinstance(old, str) or not hmac.compare_digest(_hash(old, r[0]), r[1]): raise PermissionError("current password is wrong")
            salt = secrets.token_bytes(16)
            c.execute("UPDATE users SET salt=?, hash=? WHERE id=?", (salt, _hash(new, salt), uid)); c.execute("DELETE FROM sessions WHERE uid=?", (uid,)); c.commit()
        finally: c.close()
def delete_account(runs, uid, pw):
    import shutil
    with _lock:
        c = _db(runs)
        try:
            r = c.execute("SELECT salt, hash FROM users WHERE id=?", (uid,)).fetchone()
            if not r or not isinstance(pw, str) or not hmac.compare_digest(_hash(pw, r[0]), r[1]): raise PermissionError("password is wrong")
            c.execute("DELETE FROM sessions WHERE uid=?", (uid,)); c.execute("DELETE FROM users WHERE id=?", (uid,)); c.commit()
        finally: c.close()
    d = os.path.join(runs, "users", uid)
    if os.path.isdir(d): shutil.rmtree(d)
def user_dir(runs, uid):
    if not re.fullmatch(r"[0-9a-f]{16}", uid): raise ValueError("bad user id")
    d = os.path.join(runs, "users", uid); os.makedirs(d, exist_ok=True); return d
