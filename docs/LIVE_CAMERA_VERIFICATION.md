# Live camera patch, Nov 4 2026 15:47 Toronto

Live mode uses browser getUserMedia, preferring the outward camera, rolling complete five-second MediaRecorder segments, bounded queue, automatic local V-JEPA2/frozen384 analyses and UNCONFIRMED suggestions. It can skip segments. It is not every-frame or guaranteed instant monitoring.

Fixes: CPU inference threads default to 2 (LABSPOTTER_CPU_THREADS override), generic mobile MP4/WebM MIME fallback, recorder errors stop tracks with recovery text, explicit phone/computer wording and HTTPS/permission guidance, video/* upload support, full multi-word saved prediction labels in pause recap. Classifier/head and saved evidence unchanged.

Actual tests on updated build: real local Chromium fake camera at desktop and 390x844; at least two automatically recorded segments each return HTTP200 with 16 decoded frames and actual frozen384 predictions. Pause saves recap and stops tracks; Resume does not reopen camera. Offline cached weights and no Meta keys/calls. Five camera/label unit checks pass, production build and explicit TS typecheck pass. Full regression before final display-label-only change: 21 voice, 62 general, 20 GUI unit, 90 fixture browser checks passed. Repeated real-camera tests rerun after display fix passed. Screenshots captured after animation settled, not mid-fade.

NOT VERIFIED: actual physical iPhone/Safari or Android camera, external HTTPS host camera behavior. Temporary Cloudflare test approved but not started because persistent runtime unavailable. No deployment or film recording authorized to resume by this report.
