# LabSpotter app: tested environments, install, launch, recovery, gaps (development; updated 2026-11-04 00:50 ET, original 2026-11-02)

This is a development build. Nothing here is a production claim. The user's 75% minimum is NOT met by the selected head. Its development numbers are balanced accuracy on a spent 229-clip validation set, which is a different metric from a raw-accuracy target, so no like-for-like comparison is made here.

## 1. Tested environments (what actually ran; not the same as requirements.txt)
| Purpose | Environment | What ran | Result |
|---|---|---|---|
| Offline tests and smoke (no encoder) | Python 3.10.12, fresh venv, `pip install scikit-learn==1.6.1 numpy==2.2.6` | `bash ./run_all_tests.sh`, `bash ./smoke.sh`, `python3 check.py` on a tree re-fetched from this branch (not a git clone) | UNIT TESTS PASS (36 on 11-02; the current tree runs 61 Python unit tests, 16 GUI unit tests and the stub browser suite in `run_all_tests.sh`, all passing on 11-04), SMOKE PASS, check PASS |
| GUI against a STUB backend | Chrome 156.0.8078.47, playwright-core 1.64.1 (npm, installed outside the repo copy) | `gui/e2e_stub_test_NOT_REAL_BACKEND.mjs`, desktop and mobile | 33 PASS on 11-02; current tree: 90 PASS, 0 FAIL (stub e2e) plus a 5-check guide stub; stub head, no real inference |
| Real encoder + CLI + `/api/analyze` | Free Kaggle CPU notebook: Python 3.13.15, torch 2.11.0+cpu, transformers 5.16.1, Pillow 13.0.0, scikit-learn 1.6.1, numpy 2.1.3, opencv 4.14.0, ffmpeg 6.1.1 | one demo clip, code-only copy of app/ (no gui/) | CLI exit 0; API 401/401/401, 200 in 29.1 s, 409 on repeat tag, readback 200, unknown run 404 (see verification/runtime_canon2_report.md) |
| Real V-JEPA encoder behind the GUI (Kaggle CPU run 3, 11-03) | Free Kaggle CPU notebook, fake camera live flow, no Meta key there | First suggestion about 33 s; quick look absent as expected | One notebook environment; no phone; real Meta was not part of it |
| Live camera flow, real Meta quick look (11-03/04) | Chromium with a fake camera, real server.py, a STUB analysis server, the real Meta route | 4 in-flow Meta calls, all HTTP 200, 4.8 to 5.6 s each | The real encoder and real Meta have NOT run together in one flow. The text is a free-form description, not the trained detector |
| Browser speech (11-04) | Windows Chrome in a cloud browser, 22 voices, a plain test page (not the app component) | A trusted click started speech (start event at 10 ms, end event at 4.3 s). Without a click the browser refused it (not-allowed) | Exact limit: only browser start/end events were observed. Nothing was heard, the app's own button was not used in that browser, and iOS/Android were not tested. The app speaks only after a tap and shows a message if the voice fails |
| Fresh clean-folder launch (11-04) | Empty folder with the tested files, server.py, Chrome 1440 px | Page and assets 200, 0 page errors, health up with deps_ok false (no encoder installed there) | Not a git clone, no pip install, no model run |

Not tested: any other Python/torch/transformers/Pillow version; GPU; macOS or Windows as hosts; concurrent requests with the real encoder; a real phone or the private Tailscale route.

## 2. requirements.txt is PARTIAL
Pinned and tested: scikit-learn==1.6.1, numpy==2.2.6 (offline tests). Encoder packages torch, transformers, Pillow are minimums only. The versions in the third table row ran once, so treat them as the known-good reference, not a lockfile. ffmpeg must be on PATH.

## 3. Install and launch (commands; the first two blocks are the tested paths)
Offline checks:
    python3 -m venv .venv && . .venv/bin/activate
    pip install scikit-learn==1.6.1 numpy==2.2.6
    bash ./run_all_tests.sh && bash ./smoke.sh && python3 check.py
Real analysis (adds the encoder; first call downloads about 1.5 GB of weights from the Hugging Face hub; about 20-30 s per clip on a 2-thread CPU):
    pip install torch transformers pillow   # generic minimums: a full reproducible environment is NOT recorded; the Kaggle CPU versions in section 1 are the only known-good reference
    python3 server.py                       # 127.0.0.1:8765, token printed once to an interactive terminal
    python3 chain/action_clip.py <tag> clip.mp4
Set the token yourself for non-interactive use: `LABSPOTTER_TOKEN=<value> python3 server.py` (send it as header X-LabSpotter-Token). Do not put it in files, logs or URLs.
Environment variables: LABSPOTTER_RUNS (run storage), LABSPOTTER_HEAD_CONFIG, LABSPOTTER_MAX_RUNS, LABSPOTTER_READ_TIMEOUT, LABSPOTTER_UPLOAD_DEADLINE, LABSPOTTER_FFMPEG_TIMEOUT, LABSPOTTER_EXTRA_ORIGIN. Live Meta calls (recap on pause and the live quick look) stay off unless LABSPOTTER_LIVE_CLEARED=1 and MODEL_API_KEY are set, with a spend ledger. The key is never stored in the repo. Without them the app still works and shows a plain local summary.

Private phone use (camera needs https): see docs/PRIVATE-PHONE-TAILSCALE.md and `bash start-private-phone.sh`. Written from Tailscale's docs, not yet tried on a real phone or laptop.

## 4. Errors and recovery (messages from the code; the 401, 409 and 404 rows were observed in the real run, the rest are read from the code and not all exercised)
- 401 "session token required": send X-LabSpotter-Token with the token printed at startup (observed).
- 409 "run tag ... already exists": pick a new tag. Do not delete old runs to reuse a tag: they are the saved history. Runs are never overwritten (observed).
- 404 "no such run": the run is missing or incomplete; a run counts only once result.json and predictions.json both exist (observed for an unknown run).
- 403 "unknown host": the Host header must be the bind address, localhost or 127.0.0.1 with the same port. Reaching the server through a proxy or tunnel needs LABSPOTTER_EXTRA_ORIGIN set deliberately (from the code, tested once on the earlier package with a quick tunnel).
- "head config not found / missing keys / head hash mismatch / head file not found": run from a complete package, or set LABSPOTTER_HEAD_CONFIG; never edit the hash to make it pass (from the code, covered by tests/test_head_launch_config.py).
- "no frames decoded from <clip>": the clip is unreadable, or ffmpeg is missing from PATH (from the code).
- 500 "analysis failed ... check the server log": look at the server's console output (from the code).
- Slow first request: the encoder weights are downloading or loading (observed about 6 s for health and 29 s for the first analyze on a warm cache).
- Restart cleanly: stop the server (Ctrl-C), start it again. Stored runs persist under LABSPOTTER_RUNS.

## 5. Gaps before any production use (listed, not fixed here)
1. Accuracy: the 75% minimum is not met. The selected head has development numbers only (balanced accuracy on a spent validation set), which are not directly comparable to a raw-accuracy target. All numbers are development evaluation.
2. Dependencies: only partially pinned; one tested encoder environment; no lockfile or container.
3. The real encoder behind the GUI has run on a Kaggle CPU notebook (row above), and the real Meta route has run with a stub analysis, but the real encoder and the real Meta route have NOT run together in one flow. The stub GUI suite uses a stub backend.
4. No throughput, memory or concurrency measurement under load on the real encoder.
5. Weights are fetched at first use from the Hugging Face hub (network required, unauthenticated download worked once; rate limits not tested).
6. Alerts stay pending_review. The VALIDATED registry is empty and no approval is recorded. Meta calls are off unless the key and clearance variables are set; this run's test calls are in docs/META-SPEND-NOTE-NOV3-4.md (older ledger entries not rolled up).
6b. Privacy before enabling Meta: with a key and clearance set, short clips and typed notes are sent to Meta. The Meta billing page for this account reads "While using free credits your content may be used for product improvement" (read 2026-11-04 at https://dev.meta.ai/billing, signed-in page; not a public URL). Do not send private or sensitive footage or notes. The app shows a matching notice on its start screen.
7. The package was built from v3 archive parts by web upload, which dropped exec bits; documented commands use `bash ./...`.
