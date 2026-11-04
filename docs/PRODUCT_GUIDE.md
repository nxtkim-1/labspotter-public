# Using LabSpotter

Current product scope, November 4, 2026. This guide describes the web app, not a native phone app or a deployed-service guarantee.

## Choose how to start

A written guide lets you keep notes and confirm steps without video analysis. The built-in water-measuring guide is explicitly an example, not an assigned or validated lab procedure. A custom guide supplies its own title, source, and steps.

A video session adds a short clip for the server's action classifier. The model returns a suggested action; agreeing with that label does not automatically complete a guide step.

Local mode asks for the start code from the server launcher. Account mode uses sign-up/sign-in and stores each account's records separately. The server must be running and reachable for saved entries to load.

## Suggestions and confirmations

Treat the action label as a suggestion. Review it, agree with it or change it, and keep your own observation beside it. The original model claim and the person's decision have different sources in the saved record.

In the guide, **Correct** means you are confirming that you did that step yourself. Only that tap marks the guide step done. The classifier does not infer procedural completion.

The Review page's Seen and Flag controls are your manual marks for the demo clips. Seen means you looked; Flag means you want to check again. They are browser-local, not shared account confirmations or automatically detected problems.

## Save an observation

Type into the note field and save. When Meta voice is enabled, recording produces an editable transcript draft; review the text, change anything wrong, then save it. A spoken note is still your observation, not a model-verified finding.

If voice is off, type the note instead. Browser microphone permission and an operator's Meta configuration are separate requirements. The working generated-audio check does not certify a physical microphone or every phone browser.

Open **What's saved** to see the entries and their sources. The timestamp is the server save time, not a verified recording or event time. A note about a possible problem records what was said; it does not diagnose that problem.

## Pause and return

Use **Pause and save my place**. Continue restores the saved session and its user-confirmed guide steps after checking record integrity. Restoring a session does not confirm that equipment, samples, or the physical bench are unchanged.

In account mode, sign into the same account on the same site/server from another browser to reopen the server-saved session. This does not transfer data between unrelated deployments. Theme preferences and Review demo marks stay in the browser.

A camera segment held only in the current tab is different from a saved entry. The app labels that pending segment; closing or reloading the tab can lose it.

## Name sessions and organize projects

Open **Projects**. Create a project, give a saved session a useful name, choose its project, and use **Save label**. Use the Project filter to narrow the list. The names and project assignments live under your account on this server and restore in another browser signed into the same account. They do not rewrite the original checkpoint evidence.

Project grouping does not create a team workspace or grant another person access.

## Export the record

In **What's saved**, use **Download session record**. The JSON contains the session identifier, export time, timestamp meaning, and saved checkpoint entries. It is a portable record to inspect, not a video archive, a full deployment backup, or an automatic import into another server.

On Projects, **Export session** downloads an individual record. **Export these sessions** downloads the sessions in the current filtered view, with their names, project identifiers, and checkpoints. The demonstrated export contained one session.

Review the export before sharing it. Notes can contain private information. Exporting a record does not authorize anyone else to receive it.

## Optional summaries

Without Meta, the app can recap the entries already saved. With an enabled Meta recap route, a Meta model can summarize saved session text. It does not inspect the current physical bench or verify the notes. Account-mode agent routes remain disabled in the current launch configuration.

## Camera and phone use

The camera needs browser permission and a supported secure context. The browser segments the video; the server analyzes pieces rather than guaranteeing coverage of every moment. The interface reports skipped segments. CPU analysis can take longer than capture, so do not treat the view as a complete live event record.

Phone-width browser layouts have been checked. A physical iPhone/Android camera or microphone flow and native app distribution have not been established by those checks.

## Settings and data

Account mode includes sign-in/out, password change, account/data deletion, and theme settings. Deletion is destructive: export anything you need to keep first. No public sharing or team workspace is implied by having an account.

See [build evidence](BUILD_EVIDENCE.md) for the exact model and development-test scope, and [the runbook](RUNBOOK.md) for host setup and recovery.
