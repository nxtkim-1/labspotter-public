# frozen384 pickle compatibility check

`heads/frozen384.pkl` was pickled with scikit-learn 1.7.2; `requirements.txt` pins 1.6.1. This check runs the same
head on every stored frozen384 feature set under both versions and compares the outputs. It changes nothing.

## Build the two venvs (once, needs network)

    python3 -m venv /tmp/skl1.6.1 && /tmp/skl1.6.1/bin/pip install numpy==2.2.6 scikit-learn==1.6.1
    python3 -m venv /tmp/skl1.7.2 && /tmp/skl1.7.2/bin/pip install numpy==2.2.6 scikit-learn==1.7.2

## Run (from app/)

    bash tools/check_pickle_compat.sh /tmp/skl1.6.1 /tmp/skl1.7.2 [/tmp/pickle_compat_out]

Each venv runs `tools/check_pickle_compat.py --dump`: it checks the head sha256 against `heads/active.json` (aborts on
mismatch), unpickles it (recording any warnings, e.g. InconsistentVersionWarning), finds feature sets under the repo root
(`*.npz`/`*.npy`, skipping node_modules/.git/venvs) and saves predict_proba (float64) + predict per set. Sets used:
`<clip>__h`/`<clip>__lg` archives (rows = concat(h, lg) as in check.py); `X`+`names` archives whose first 1198 columns
are h(1024),lg(174) according to `heads/candidate_concat_*.json` and its `.feature_hashes.json` `concat_order`; any array
with last dim 1198. Everything else is listed as SKIPPED with a reason. Add files with `--features PATH`.
Then `--compare A.npz B.npz [--tol 0.0]` prints, per set, n clips, max |predict_proba diff| (repr, full precision),
label mismatches and both versions.

## What PASS means

Exit 0 only if the two dumps ran different scikit-learn versions, cover the same sets and clip ids, have 0 label
mismatches and max diff <= tol (default 0.0 = bit-identical). It says nothing about inputs not stored in the repo.
