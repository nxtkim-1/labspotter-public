# Saved sessions: threat model (private build notes)

Normal flow: Save session, then Continue from the Saved sessions list. No key is shown or typed.

- Auth: GET /api/bench/sessions and POST /api/bench/session/<id>/continue sit behind the same owner token (X-LabSpotter-Token), Host and Origin checks as every /api/bench route. No token: 401.
- No bearer keys stored: the freezes table holds only a hash of the freeze key. The list returns session id, entry count, saved time and freeze status. It never returns a key.
- Integrity: both endpoints run store.load_run (hash chain plus recorded head) and compare the newest freeze's checkpoint hash with the stored chain. A failed chain is listed as not intact (no Continue) and a continue is refused with 409.
- Isolation: one backend, one owner token. Ids are 12 hex characters. Unknown ids give 404. Only classifier_session records are listed.
- The portable key path (POST /api/bench/resume, key file or paste) is unchanged and independent. It also needs the owner token.
- Meaning is unchanged: restored entries stay unconfirmed model suggestions, BENCH STATE UNKNOWN, SAFETY CLEARANCE NO.
- Scope limit: Continue covers sessions on this backend. Moving a session to another backend uses the backup file.
Tests: tests/test_bench_continue.py (auth, no-key list, continue, tamper 409, isolation), gui/e2e_bench_flow.mjs (list, continue after SIGKILL restart, file download and choose).
