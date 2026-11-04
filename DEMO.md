# LabSpotter demo walkthrough

A working-flow demonstration, not a model benchmark. Use the current app and actual captured output. The three-minute film should lead with the useful result: a lab record that keeps model suggestions, a person's observations, and their own confirmations separate.

## Suggested sequence

### 0:00-0:20 - The interruption

Show the real interface and a written guide. Explain the need in one line: “LabSpotter keeps what I observed, what the model suggested, and where I stopped in one record.”

Use the water-measuring example only with its example label visible. It is not a validated lab protocol.

### 0:20-0:55 - A reviewable action suggestion

Add a licensed demo clip and show the actual returned action. Label sped-up processing when compressing the CPU wait. Show a person's decision separately from the suggestion. A correct clip demonstrates the pipeline, not overall recognition accuracy.

Explain the chain: Meta V-JEPA 2 features, our trained eight-action head, then the person's review. Do not say the classifier verified the next protocol step.

### 0:55-1:35 - An observation becomes a saved record

Show a typed observation or the actual Meta-transcribed test draft, edit it, and save. Open What's saved and show its source and server save time.

If using the generated female-voice test, caption it “Generated test audio → real Meta transcription → editable draft → saved note.” Do not present it as a recording of Thomas, a live physical microphone, or a contamination diagnosis.

### 1:35-2:15 - Pause and return

Pause the real session. Reopen the same saved record, preferably in the fresh independent browser context used for the account-restore check. Show the same entries and saved times.

Caption: “Same account, same server. Saved times are when entries were saved, not verified event times.” Do not imply Review demo marks synchronize across devices or that restoring a record checks the bench.

### 2:15-2:40 - Take the record with you

Open Projects, show the named session and its project, then use Export session (or the filtered Export these sessions). Show the actual JSON's session identifier, timestamp meaning, and entries. Do not show private account data or credentials. The export is a record, not an automatic cross-server import.

### 2:40-3:00 - The product and the next step

End on the product, its Meta components, and the next engineering goal: better recognition on fresh source-separated data and broader device testing. If a measurement is shown, keep the complete label together:

“Selected head: 0.512 balanced accuracy, 229 official validation clips, 5 sources, 8 classes. Validation set spent for development; not a blind test.”

## Before publishing

- Replace planning shots with actual captures; do not film unimplemented UI as a working feature.
- Preserve imported-demo and model-suggestion labels.
- Keep the UI's user-confirmed completion separate from the predicted action.
- No credentials, launch codes, backup keys, private notes, billing screens, or private allowance files in any frame or download shown.
- Use third-party footage with the repository's attribution and licence notices. Do not claim Thomas filmed the IBM demo clips.
- Publish a final video link only after the finished video is uploaded and checked. This file is a runbook, not the finished video.

See [the product guide](docs/PRODUCT_GUIDE.md) and [build evidence](docs/BUILD_EVIDENCE.md) for scope and provenance.
