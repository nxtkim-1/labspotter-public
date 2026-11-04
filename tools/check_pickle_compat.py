"""Pickle-compatibility check for heads/frozen384.pkl across scikit-learn versions (stdlib + numpy + sklearn only).

  python3 tools/check_pickle_compat.py --dump OUT.npz [--features PATH ...]
      In THIS interpreter: verify the head sha256 against heads/active.json, unpickle it (warnings recorded), run
      predict_proba + predict on every stored frozen384 feature set found under the repo root, save everything to OUT.npz.
  python3 tools/check_pickle_compat.py --compare A.npz B.npz [--tol 0.0]
      Exit 0 only if A and B ran different sklearn versions, cover the same sets and clips, have 0 label mismatches and
      max |predict_proba diff| <= tol (default 0.0 = bit-identical).
See tools/PICKLE_COMPAT.md. Nothing here modifies the head, the pins or any feature file (feature files are loaded with allow_pickle=False)."""
import argparse, glob, hashlib, json, os, pickle, platform, re, sys, warnings
import numpy as np

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(APP)
H_DIM, LG_DIM = 1024, 174
IN_DIM = H_DIM + LG_DIM  # 1198 = frozen384 input
SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", "venvs", "env", ".env", "site-packages", "__pycache__", ".tox"}


def rel(p):
    p = os.path.abspath(p)
    return os.path.relpath(p, REPO) if p.startswith(REPO + os.sep) else p


def load_head():
    cfg = json.load(open(os.path.join(APP, "heads", "active.json")))
    if cfg.get("head_file") != "frozen384.pkl":
        sys.exit("FATAL: heads/active.json names %r, not frozen384.pkl - refusing to guess" % cfg.get("head_file"))
    p = os.path.join(APP, "heads", cfg["head_file"])
    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if sha != cfg["head_sha256"]:
        sys.exit("FATAL: head sha256 mismatch for %s: file %s != active.json %s" % (rel(p), sha, cfg["head_sha256"]))
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        with open(p, "rb") as f: head = pickle.load(f)
    return head, sha, ["%s: %s" % (x.category.__name__, x.message) for x in w]


def scan(root):
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not os.path.isfile(os.path.join(d, x, "pyvenv.cfg")))
        out += [os.path.join(d, f) for f in sorted(files) if f.endswith((".npz", ".npy"))]
    return out


def concat_order_from_docs(ncols):
    """Read the documented concat order of a candidate concat head whose total dim == ncols. Returns (order, docs) or (None, reason)."""
    found = []
    for j in sorted(glob.glob(os.path.join(REPO, "heads", "candidate_concat_*.json"))):
        if j.endswith(".feature_hashes.json"): continue
        try: c = json.load(open(j))
        except ValueError as e: return None, "%s is not valid JSON (%s)" % (rel(j), e)
        if c.get("total_dims") != ncols: continue
        order1 = list(zip(c.get("features", []), c.get("dims", [])))
        hj = j[:-len(".json")] + ".feature_hashes.json"
        if not os.path.isfile(hj): return None, "%s exists but %s is missing" % (rel(j), rel(hj))
        co = json.load(open(hj)).get("concat_order")
        if not isinstance(co, str): return None, "%s has no concat_order string" % rel(hj)
        order2 = [(n, int(d)) for n, d in re.findall(r"([A-Za-z0-9_]+)\((\d+)\)", co)]
        if order1 != order2:
            return None, "%s features/dims %r disagree with %s concat_order %r" % (rel(j), order1, rel(hj), co)
        found.append((order1, "%s + %s (concat_order %r)" % (rel(j), rel(hj), co)))
    if not found: return None, "no heads/candidate_concat_*.json at the repo root documents total_dims == %d" % ncols
    if len({tuple(o) for o, _ in found}) > 1: return None, "conflicting concat orders: %s" % [d for _, d in found]
    return found[0]


def feature_sets(paths):
    """Yield (set_id, layout, X, clip_ids, note) for usable sets; collect (path, reason) for skipped ones."""
    sets, skipped = [], []
    for p in paths:
        rp = rel(p)
        try: z = np.load(p, allow_pickle=False)
        except Exception as e: skipped.append((rp, "not loadable as a numpy array without pickle (%s)" % type(e).__name__)); continue
        if isinstance(z, np.ndarray):  # .npy
            if z.ndim >= 1 and z.shape[-1] == IN_DIM and z.dtype.kind in "fiu":
                X = z.reshape(-1, IN_DIM); sets.append((rp, "raw-1198", X, ["row%d" % i for i in range(len(X))], "used as-is"))
            else: skipped.append((rp, "array shape %s dtype %s: last dim is not %d" % (z.shape, z.dtype, IN_DIM)))
            continue
        try: keys = list(z.files)
        except Exception as e: skipped.append((rp, "not an npz archive (%s)" % e)); continue
        used = set()
        # layout 1: "<clip>__h" (1024) + "<clip>__lg" (174); rows as in check.py: sorted clips, concat(h, lg)
        clips = sorted({k[:-4] for k in keys if k.endswith("__lg")})
        if clips:
            try:
                bad = [c for c in clips if c + "__h" not in keys or z[c + "__h"].shape != (H_DIM,) or z[c + "__lg"].shape != (LG_DIM,)]
                if bad: skipped.append((rp, "layout 1 but clips %s lack a (1024,) __h or (174,) __lg" % bad[:5]))
                else:
                    X = np.stack([np.concatenate([z[c + "__h"], z[c + "__lg"]]) for c in clips])
                    sets.append((rp, "layout1-h-lg", X, clips, "rows = concat(<clip>__h, <clip>__lg), clips sorted (as check.py)"))
            except Exception as e: skipped.append((rp, "layout 1 arrays unreadable (%s)" % type(e).__name__))
            used |= {c + "__h" for c in clips} | {c + "__lg" for c in clips}
        # layout 2: X (n, total) + names; frozen384 input = X[:, :1198] only if the repo-root docs say h(1024),lg(174) come first
        if "X" in keys and "names" in keys:
            used |= {"X", "names"}
            try: X, names = z["X"], z["names"]
            except Exception as e: skipped.append((rp + "::X", "X/names unreadable without pickle (%s)" % type(e).__name__)); X = None
            if X is not None:
                if X.ndim != 2 or len(names) != len(X): skipped.append((rp + "::X", "X shape %s / names %d not a (n, d) matrix with one name per row" % (X.shape, len(names))))
                elif X.shape[1] == IN_DIM: sets.append((rp + "::X", "raw-1198", X, [str(n) for n in names], "X used as-is"))
                else:
                    order, doc = concat_order_from_docs(X.shape[1])
                    if order is None: skipped.append((rp + "::X", "layout 2: " + doc))
                    elif order[:2] != [("h", H_DIM), ("lg", LG_DIM)] or sum(d for _, d in order) != X.shape[1]:
                        skipped.append((rp + "::X", "layout 2: documented order %r does not start h(1024),lg(174) / total != %d" % (order, X.shape[1])))
                    else: sets.append((rp + "::X[:, :1198]", "layout2-concat-prefix", np.ascontiguousarray(X[:, :IN_DIM]), [str(n) for n in names], "order from " + doc))
        for k in keys:
            if k in used: continue
            try: a = z[k]
            except Exception as e: skipped.append((rp + "::" + k, "unreadable without pickle (%s)" % type(e).__name__)); continue
            if a.ndim >= 1 and a.shape[-1] == IN_DIM and a.dtype.kind in "fiu":
                X = a.reshape(-1, IN_DIM); sets.append((rp + "::" + k, "raw-1198", X, ["row%d" % i for i in range(len(X))], "used as-is"))
            else: skipped.append((rp + "::" + k, "unknown layout: shape %s dtype %s (last dim not %d)" % (a.shape, a.dtype, IN_DIM)))
    return sets, skipped


def dump(out, extra):
    import sklearn
    head, sha, load_warn = load_head()
    paths = scan(REPO); seen = {os.path.realpath(p) for p in paths}
    for p in extra:
        if os.path.realpath(p) not in seen: paths.append(p); seen.add(os.path.realpath(p))
    sets, skipped = feature_sets(paths)
    arrays, meta_sets = {}, []
    for i, (sid, layout, X, clips, note) in enumerate(sets):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            proba = np.asarray(head.predict_proba(X), dtype=np.float64); labels = head.predict(X)
        arrays["s%d_proba" % i] = proba
        arrays["s%d_labels" % i] = np.array([str(x) for x in labels])
        arrays["s%d_clips" % i] = np.array(clips)
        meta_sets.append({"id": sid, "layout": layout, "n": len(clips), "input_dtype": str(X.dtype), "note": note,
                          "warnings": ["%s: %s" % (x.category.__name__, x.message) for x in w]})
        print("SET  %-60s %-22s n=%d" % (sid, layout, len(clips)))
    for p, r in skipped: print("SKIP %s: %s" % (p, r))
    meta = {"sklearn": sklearn.__version__, "numpy": np.__version__, "python": platform.python_version(), "executable": sys.executable,
            "head_sha256": sha, "classes": [str(c) for c in head.classes_], "load_warnings": load_warn, "sets": meta_sets,
            "skipped": [list(s) for s in skipped]}
    np.savez(out, meta=np.array(json.dumps(meta)), **arrays)
    print("sklearn %s numpy %s python %s head %s" % (meta["sklearn"], meta["numpy"], meta["python"], sha[:12]))
    print("load warnings: %s" % (load_warn or "none"))
    print("wrote %s (%d sets, %d skipped)" % (out, len(sets), len(skipped)))
    if not sets: sys.exit("FATAL: no usable feature set found")


def _read(p):
    z = np.load(p, allow_pickle=False); meta = json.loads(str(z["meta"]))
    return meta, {s["id"]: (z["s%d_proba" % i], z["s%d_labels" % i], z["s%d_clips" % i]) for i, s in enumerate(meta["sets"])}


def compare(a, b, tol):
    ma, sa = _read(a); mb, sb = _read(b); fails = []
    for tag, m, p in (("A", ma, a), ("B", mb, b)):
        print("%s: %s  sklearn %s numpy %s python %s head %s" % (tag, p, m["sklearn"], m["numpy"], m["python"], m["head_sha256"][:12]))
        print("   load warnings: %s" % (m["load_warnings"] or "none"))
    if ma["sklearn"] == mb["sklearn"]: fails.append("both dumps ran sklearn %s - nothing compared across versions" % ma["sklearn"])
    if ma["head_sha256"] != mb["head_sha256"]: fails.append("different head sha256")
    if ma["classes"] != mb["classes"]: fails.append("different classes_ %r vs %r" % (ma["classes"], mb["classes"]))
    if not sa: fails.append("no feature sets in A")
    for sid in sorted(set(sa) | set(sb)):
        if sid not in sa or sid not in sb: fails.append("set %s only in %s" % (sid, "B" if sid not in sa else "A")); print("SET %s: only in one dump" % sid); continue
        (pa, la, ca), (pb, lb, cb) = sa[sid], sb[sid]
        if ca.tolist() != cb.tolist() or pa.shape != pb.shape:
            fails.append("set %s: clip ids/shapes differ" % sid); print("SET %s: clip ids or shapes differ" % sid); continue
        d = np.abs(pa - pb); d[np.isnan(pa) & np.isnan(pb)] = 0.0
        mx = float(np.max(d)) if d.size else 0.0; mism = int(np.sum(la != lb))
        print("SET %s  n=%d  max|proba diff|=%r  label mismatches=%d  sklearn %s vs %s" % (sid, len(ca), mx, mism, ma["sklearn"], mb["sklearn"]))
        if mism: fails.append("set %s: %d label mismatches" % (sid, mism))
        if not mx <= tol: fails.append("set %s: max diff %r > tol %r" % (sid, mx, tol))
    sk = sorted({tuple(s) for s in ma["skipped"] + mb["skipped"]})
    print("SKIPPED (%d):" % len(sk)); [print("  %s: %s" % s) for s in sk]
    if fails: print("RESULT: FAIL"); [print("  - " + f) for f in fails]; return 1
    print("RESULT: PASS (different sklearn versions, same sets/clips, 0 label mismatches, max diff <= tol %r)" % tol); return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dump", metavar="OUT.npz"); g.add_argument("--compare", nargs=2, metavar=("A.npz", "B.npz"))
    ap.add_argument("--features", action="append", default=[], metavar="PATH", help="extra feature file (repeatable)")
    ap.add_argument("--tol", type=float, default=0.0)
    a = ap.parse_args()
    if a.dump: dump(a.dump, a.features)
    else: sys.exit(compare(a.compare[0], a.compare[1], a.tol))
