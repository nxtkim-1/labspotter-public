# Build evidence and model record

November 4, 2026. This index preserves the distinction between a working product flow, a component test, and a model-quality measurement. Counts below describe particular development checks; they are not a combined certification score.

## The selected model

`heads/active.json` selects `heads/frozen384.pkl`:

```text
SHA256 c5af2cb494eeee2880ec8d7103df10f522dfd2be5de68eb42f8548bc4c733c64
```

The head is a StandardScaler + logistic-regression classifier trained on 384 IBM training clips. The frozen V-JEPA 2 route produces a 1,198-dimensional feature vector: 1,024-dimensional mean hidden features plus 174 SSv2 classifier logits. The eight lab-action labels come from our trained head, not from relabeling SSv2 classes.

**Selected-head measurement: 0.512 balanced accuracy on 229 official validation clips from 5 sources, across 8 classes.** This validation set has since been used for development and is spent, not blind. Balanced accuracy is different from raw accuracy; the 75% raw-accuracy target has not been met.

The included `candidate_c003_1427.pkl` scored 0.528 balanced accuracy on the same 229 clips but is not selected. Do not attach that number, a larger development-CV result, a training score, or selected-clip success to the active app head.

Details and the correction of an earlier mislabeled table remain in [VIDEO_ACTION_CHAIN.md](VIDEO_ACTION_CHAIN.md), [DEVELOPMENT_NOTES.md](DEVELOPMENT_NOTES.md), and [DEV_RESULTS_1427.md](../DEV_RESULTS_1427.md).

## Working-flow evidence

| Flow | Recorded evidence | What it does not establish |
| --- | --- | --- |
| Real video analysis | A real V-JEPA 2 encoder processed a demo clip through CLI/API; a separate real-encoder GUI check exercised suggestions and all eight probabilities. Historical scripts/results are described in the runbook and development notes. | Overall accuracy, new-video generalization, throughput, or phone performance. |
| Save, stop, restart, restore | A real-encoder development flow saved a model claim, stopped the backend, restarted, and restored the record; 13 checks passed in the recorded flow. | A physical bench being unchanged or safe. |
| Accounts | Account-mode implementation and development tests exercise authentication and account-scoped data. | A currently deployed public service or production security certification. |
| Observation log, November 4 | A generated 8.52-second female-voice test recording reached the real Meta transcription route, which returned HTTP 200. Its editable draft was saved with a server timestamp and spoken-note provenance. | Physical-microphone capture, phone audio quality, or verification of the observation itself. |
| Restore and JSON, November 4 | A fresh independent browser context signed into the same account on the same server and restored the same three saved entries. The actual JSON download contained those three checkpoints. | Native apps, cross-server transfer, or synchronization of browser-local Review marks. |
| Projects and session labels, November 4 | Two metadata unit tests passed: persisted names/project assignments, rejection of unknown project references, separate-root isolation, and unchanged immutable checkpoint evidence. A real account-mode local-browser flow created a project, named and assigned a session, exported one session as JSON, and restored the label/project in a fresh browser context. Four light/dark desktop/phone-width layouts passed the overflow check. | Public deployment or team sharing. A separate real HTTP check also verified that a second account sees empty metadata and receives 404 when trying to rename the first account's session. |
| Responsive interface, November 4 | Light/dark layouts at 1,440-pixel desktop and 390-pixel phone width; screenshots showed no horizontal page overflow. The milestone recorded 26 real-server interaction checks, 16 GUI unit checks, and a passing Vite build. | A physical-phone camera/microphone test or all browser/device combinations. |
| Optional Meta components | Real Meta quick-look requests and the real speech-to-text request have succeeded in their recorded development checks. | The real encoder, live camera, Meta quick look, and voice all running together in one deployed flow. |

The voice test text described a possible observation. The app preserved it as a user's note. Neither the transcript nor the saving workflow detected contamination or verified a sample's condition.

## Re-run checks by scope

- `bash ./run_all_tests.sh`: Python tests, GUI unit tests, and a browser suite against a stub backend when prerequisites are available. Read skips and failures rather than treating the final line as evidence for omitted checks.
- `LABSPOTTER_REAL_E2E=1 node gui/e2e_real_backend.mjs`: explicitly enabled real-backend check; needs the encoder dependencies and model weights. It is not a model benchmark.
- `gui/e2e_bench_flow.mjs`: saved-session flow; the default scripted fixture is not real inference. The historical real-encoder run used `BENCH_REAL=1`.
- `gui/e2e_hosted.mjs` and `tests/test_hosted.py`: account-mode development checks. “Hosted mode” names an application configuration, not proof of a public deployment.
- `tests/test_voice_allowance.py`, `tests/test_hosted_voice.py`: voice allowance and account-mode controls. Mock-route success is different from a real Meta request.

Live Meta checks can use credits and transmit content. They are not a default setup step or a requirement for offline tests.

## Keep the technical history

The existing [runbook](RUNBOOK.md), [wiring notes](../WIRING.md), [saved-session notes](SAVED_SESSIONS.md), and [development notes](DEVELOPMENT_NOTES.md) retain older architecture, test environments, and dated results. Earlier “offline” or single-owner statements describe those versions. Read their dates alongside the current product guide and code rather than treating every historical paragraph as current behaviour.

No history needs to be rewritten to present the work clearly. The front page explains the product; these records explain how it was built and measured.
