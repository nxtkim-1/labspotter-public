# LabSpotter demo runbook (powered by BenchFreeze)

The flow below runs in the app on its backend. Clips and example predictions illustrate the flow and are not accuracy evidence. Imported example predictions (fresh1) have an unverified origin and are labelled as such in the app.

## Host
- Real host: `./run_local.sh` (torch + V-JEPA2 encoder + frozen head). CPU analysis takes about 30-40 s per clip. The recording labels that wait as sped up.
- The Meta Model API key is supplied through the environment on the machine that runs the server. It is never in the repo, notebooks, logs or frames.

## Flow (about 3 minutes)
1. Clips: drop a public demo clip (`demo_clips/AnalyticalMeasurement_step.mp4`). Analyze. The model suggests a step with a probability. It is a suggestion, shown as unvalidated.
2. Research mode: Save result, then add your own note in your own words. The classifier never writes notes.
3. Save session. It appears under Saved sessions with its date and entry count. No key is shown or typed. An optional backup file and key sit under Advanced, and the key is never shown in recordings.
4. Restart the backend. Continue the session from the Saved sessions list: the same entries, protocol and confirmed steps come back after the saved record is re-verified. Continue restores the saved record only. It is not a safety clearance, and it does not show the bench is unchanged.
5. Teaching mode: load a written protocol (the labelled water-measuring EXAMPLE, or an authorized protocol). Tap "I did this step" to confirm steps yourself. The model only suggests.
6. Meta models on screen: voice command through the Meta voice model (confirm before it acts), and the Meta agent that reviews the session summary and offers a recap, questions and suggestions. Each call is reserved against a hard spend ceiling first.

## Truthful limits
- Model output is a claimed presence only. Alerts stay pending review. Nothing is validated.
- Reported metrics are development-grade on exposed splits. The app's frozen head is not the cross-validated head. See `DEV_RESULTS_1427.md`.
- After a page reload the app shows the recorded run, not the earlier upload. The chip says so.

## Checks
`./run_all_tests.sh` (stub E2E) and `gui/e2e_combined2.mjs` (real-host flow, restart, resume, Teaching, mobile).
Before publishing any frame: check every frame for tokens, keys, billing or account pages.
