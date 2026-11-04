"""Fixed demo-lifetime voice allowance. No audio/text storage, no reset on restart.
100 requests globally, 5 per account, 30s per request, US$0.10 ceiling.
Reservations survive failures, deletion and restarts. One upstream call at a time across processes.
"""
import contextlib, fcntl, json, math, os, time

@contextlib.contextmanager
def reserve(root, account, seconds):
    if not account: raise PermissionError('A signed-in account is needed for voice notes.')
    if not 0 < seconds <= 30: raise ValueError('Record between zero and 30 seconds.')
    os.makedirs(root, exist_ok=True)
    lock = open(os.path.join(root, '_voice_allowance.lock'), 'a')
    try:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise PermissionError('Voice is busy. Wait for the current recording to finish.')
        path = os.path.join(root, '_voice_allowance.jsonl')
        if not os.path.exists(path):
            # Create explicitly once at setup. Missing storage never silently grants another allowance.
            raise PermissionError('Voice allowance storage has not been set up.')
        rows = [json.loads(l) for l in open(path) if l.strip()]
        if any(r.get('kind') != 'voice_reservation' or not isinstance(r.get('seconds'), int) or not 1 <= r['seconds'] <= 30 or not isinstance(r.get('account'), str) for r in rows): raise ValueError('Invalid allowance record')
        sec = math.ceil(seconds)
        if len(rows) >= 100 or sum(r['account'] == account for r in rows) >= 5: raise PermissionError('Voice recording allowance reached.')
        if sum(r['seconds'] for r in rows) + sec > 1200: raise PermissionError('Voice credit allowance reached.')
        with open(path, 'a') as f:
            f.write(json.dumps({'kind':'voice_reservation','account':account,'seconds':sec,'at':int(time.time())})+'\n'); f.flush(); os.fsync(f.fileno())
        yield
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close()
