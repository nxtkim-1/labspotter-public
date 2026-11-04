# LabSpotter

A calm second pair of eyes for the bench. LabSpotter helps you keep your place in a lab procedure: it follows a written guide, suggests what a short video clip shows, and saves your own notes and confirmations so you can pause and pick up where you left off.

Built for the Meta Global AI Developer Hackathon. Powered by Meta: V-JEPA 2 video features, optional Meta speech transcription, and optional Meta session recaps. Session persistence is implemented by this app, not a Meta storage service.

## The problem
Lab work is made of small steps that are easy to lose when you are interrupted. Paper notes and memory do not say which step you had confirmed or what you were doing when you stopped.

## What it does
- **Guide.** A written, step-by-step guide. A step is marked done only when you tap it yourself. The app never marks a step for you.
- **Clip suggestion.** Add a short clip. A frozen V-JEPA 2 video encoder produces features, and a small classifier we trained on public lab-action clips suggests which lab action it sees. It is a suggestion, shown as not confirmed.
- **Pause and continue.** Pause saves your notes and your own confirmations. Continue shows them back to you. Saved entries cannot tell you the bench's current state; check it in person.
- **Optional recap.** A separate Meta model recap (Meta/Spark) can write a short summary of a saved session. It is off unless the server's operator turns it on with a Meta key.
- **Accounts (hosted mode).** Sign up, sign in, change password, delete your account and data. Each account only sees its own sessions and runs.

- **Observation log.** Typed and Meta-transcribed notes are saved with server save times and their source. Download the session record as JSON. Save time is not verified event time.
- **Across browsers.** Sign into the same account on the same hosted site to restore server-saved sessions. Theme and Review demo marks stay in the browser. Phone and desktop are responsive web views, not native apps.

## Privacy
- Video analysis runs on the machine that runs the server: your own computer when you run it locally, or the host's server when you use a hosted copy (so clips you add to a hosted site are processed there). The clip is not sent to Meta for the suggestion.
- Meta features are off unless the server's operator turns them on with a Meta key. If they are on, selected clips and/or saved entries may be sent to Meta. The operator controls this, not individual users. In hosted mode (`LABSPOTTER_HOSTED=1`) agent routes are disabled. Voice can be separately enabled by an operator only for invite-only accounts, with a server-side key, per-account and global lifetime limits, and a first-recording notice.
- Suggestions are not a safety check.

## Status
Development-grade. The suggestion head scored 0.512 balanced accuracy on a 229-clip validation set (8 classes). That set has since been used for development, so it is not a blind test, and balanced accuracy is a different metric from the raw-accuracy target of 75%, so the two are not comparable. The 75% target is not met, and this is not a finished detector. Background and history are in `docs/DEVELOPMENT_NOTES.md`.

## Run it
Needs Python 3.10+, ffmpeg, and Node 22.18 or newer for the GUI tests. Real analysis also needs torch, transformers and pillow (about 3 GB RAM). The first analysis downloads about 1.5 GB of V-JEPA 2 weights from Hugging Face.
```
python3 server.py            # local: http://127.0.0.1:8765 , the launch token is printed once
bash ./run_local.sh          # helper (only its --check dry run is tested; it has not been run end to end)
```
Hosted mode is set with environment variables (`LABSPOTTER_HOSTED=1`, `LABSPOTTER_PUBLIC_HOST`, `LABSPOTTER_DATA_DIR`, and `LABSPOTTER_TRUST_PROXY=1` behind a proxy). See `WIRING.md`.

## Tests
`bash ./run_all_tests.sh` runs the unit tests, the GUI unit tests, and a browser check against a stub server (not the real backend). Real-encoder browser checks are separate and need `LABSPOTTER_REAL_E2E=1`. A passing run is development evidence for that scope only.

## Licence and notices
Code: MIT, see `LICENSE`. Demo clips are IBM Research Zurich lab-action clips (CDLA-Permissive-2.0); fonts and packages keep their own licences. See `THIRD-PARTY-NOTICES.txt`.
