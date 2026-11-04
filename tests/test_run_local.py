# run_local.sh --check tests. Dry run only: no venv, no install, no network, no server.
# Exception: test_check_wheels_for_running_python runs --check-wheels, which queries the package index (nothing is
# installed); it prints SKIP when the index is unreachable. LABSPOTTER_TEST_PYTHON picks the Python it checks.
# Each test uses a temporary LABSPOTTER_RUN_DIR, a free port and a fake ffmpeg shim, so it does not depend on the host.
import os, sys, socket, shutil, subprocess, tempfile
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(APP, "run_local.sh")
CANARY = "canary-token-7f3a9c-must-never-appear"

def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def _shim(d, name, body):
    p = os.path.join(d, name)
    with open(p, "w") as f: f.write("#!/bin/sh\n" + body + "\n")
    os.chmod(p, 0o755); return p

def _bin_without_ffmpeg(d):
    # only the tools run_local.sh needs, so the host's ffmpeg (often in /usr/bin) is not reachable
    os.makedirs(d, exist_ok=True)
    for tool in ("bash", "dirname", "sed", "cat", "mkdir"):
        os.symlink(shutil.which(tool), os.path.join(d, tool))
    return d

def _run(tmp, port=None, env_extra=None, ffmpeg=True, path=None):
    fake = os.path.join(tmp, "fakebin"); os.makedirs(fake, exist_ok=True)
    if ffmpeg: _shim(fake, "ffmpeg", "echo fake ffmpeg")
    env = {k: v for k, v in os.environ.items() if k != "LABSPOTTER_TOKEN"}
    env.update(PYTHON=sys.executable, LABSPOTTER_RUN_DIR=os.path.join(tmp, "run"),
               PATH=path or (fake + os.pathsep + os.environ.get("PATH", "")))
    env.update(env_extra or {})
    r = subprocess.run([shutil.which("bash"), SCRIPT, "--check", "--port", str(port or _free_port())],
                       env=env, capture_output=True, text=True, timeout=60)
    return r.returncode, r.stdout + r.stderr

def test_check_passes_in_normal_env():
    with tempfile.TemporaryDirectory() as tmp:
        port = _free_port(); rc, out = _run(tmp, port)
        assert rc == 0, out
        assert "CHECK: PASS" in out and "http://127.0.0.1:%d/" % port in out, out
        assert "torch==2.11.0+cpu" in out and "https://download.pytorch.org/whl/cpu" in out, out
        assert "-m pip install --upgrade pip" in out, out
        assert "torchvision==0.26.0+cpu" in out, out  # the V-JEPA2 video processor imports torchvision  # old venv pip cannot install from the torch index
        pil = "Pillow==12.3.0" if sys.version_info[:2] == (3, 10) else "Pillow==13.0.0"
        assert "transformers==5.16.1" in out and pil in out, out

def test_canary_token_never_printed():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = _run(tmp, env_extra={"LABSPOTTER_TOKEN": CANARY})
        assert rc == 0, out
        assert CANARY not in out
        assert "LABSPOTTER_TOKEN" in out, out

def test_token_file_value_never_printed():
    with tempfile.TemporaryDirectory() as tmp:
        run = os.path.join(tmp, "run"); os.makedirs(run); tf = os.path.join(run, "token")
        with open(tf, "w") as f: f.write(CANARY + "\n")
        os.chmod(tf, 0o600)
        rc, out = _run(tmp)
        assert rc == 0, out
        assert CANARY not in out and tf in out, out

def test_old_python_refused():
    with tempfile.TemporaryDirectory() as tmp:
        old = _shim(tmp, "python3.9", 'echo "Python 3.9.18"')
        rc, out = _run(tmp, env_extra={"PYTHON": old})
        assert rc != 0 and "3.10" in out and "3.9" in out, out

def test_missing_ffmpeg_refused():
    with tempfile.TemporaryDirectory() as tmp:
        b = _bin_without_ffmpeg(os.path.join(tmp, "bin"))
        rc, out = _run(tmp, ffmpeg=False, path=b)
        assert rc != 0 and "ffmpeg is not on PATH" in out, out

def test_busy_port_refused():
    with tempfile.TemporaryDirectory() as tmp:
        s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(1); port = s.getsockname()[1]
        try: rc, out = _run(tmp, port)
        finally: s.close()
        assert rc != 0 and "port %d is already in use" % port in out, out

def test_token_file_0644_refused():
    with tempfile.TemporaryDirectory() as tmp:
        run = os.path.join(tmp, "run"); os.makedirs(run); tf = os.path.join(run, "token")
        with open(tf, "w") as f: f.write(CANARY + "\n")
        os.chmod(tf, 0o644)
        rc, out = _run(tmp)
        assert rc != 0 and "644" in out and "600" in out, out
        assert CANARY not in out

def test_check_does_not_create_token_file():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = _run(tmp)
        assert rc == 0, out
        assert "WOULD create token file" in out, out
        assert not os.path.exists(os.path.join(tmp, "run")), "--check created the run dir"

def test_check_creates_no_venv():
    venv = os.path.join(APP, ".venv"); before = os.path.exists(venv)
    mtime = os.stat(venv).st_mtime if before else None
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = _run(tmp)
    assert rc == 0, out
    assert os.path.exists(venv) == before, "--check created a venv"
    if before: assert os.stat(venv).st_mtime == mtime
    else: assert "WOULD create venv" in out, out

def test_output_says_download_size_and_local_not_hosting():
    with tempfile.TemporaryDirectory() as tmp:
        rc, out = _run(tmp)
        assert rc == 0, out
        assert "1.5 GB" in out and "Hugging Face" in out, out
        assert "local run on this computer, not hosting" in out and "127.0.0.1 only" in out, out

def test_pillow_pin_follows_python_version():
    # Pillow 13.0.0 has no Python 3.10 wheels, so 3.10 gets 12.3.0 (no network: a shim only reports the version)
    for ver, want, other in (("3.10.12", "Pillow==12.3.0", "Pillow==13.0.0"), ("3.13.5", "Pillow==13.0.0", "Pillow==12.3.0")):
        with tempfile.TemporaryDirectory() as tmp:
            py = _shim(tmp, "python-shim", 'echo "Python %s"' % ver)
            rc, out = _run(tmp, env_extra={"PYTHON": py, "LABSPOTTER_TOKEN": CANARY})
            assert rc == 0, out
            assert want in out and other not in out, (ver, out)

def test_check_wheels_for_running_python():
    # every pinned package must have a binary wheel for the Python that would run; needs the package index
    py = os.environ.get("LABSPOTTER_TEST_PYTHON") or sys.executable
    env = {k: v for k, v in os.environ.items() if k != "LABSPOTTER_TOKEN"}; env["PYTHON"] = py
    r = subprocess.run([shutil.which("bash"), SCRIPT, "--check-wheels"], env=env, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    if r.returncode == 3 and "WHEELS: UNREACHABLE" in out:
        print("SKIP test_check_wheels_for_running_python: package index unreachable (offline)"); return
    print(out.strip())
    assert r.returncode == 0 and "WHEELS: PASS" in out, out

if __name__ == "__main__":
    bad = 0; tests = [(k, v) for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
    for k, v in tests:
        try: v(); print("PASS", k)
        except Exception as e: bad += 1; print("FAIL", k, repr(e)[:300])
    print("test_run_local: %d PASS, %d FAIL" % (len(tests) - bad, bad))
    sys.exit(1 if bad else 0)
