# External tester checklist

Use this checklist for a tester who has real Item Assistant history. Do not send a candidate
until every P0 gate in `docs/roadmap.md` is complete.

## Before the session

1. Record the exact Cairn version or commit and the tester's Grim Dawn version.
2. Ask the tester to close Item Assistant during import. Cairn reads and backs up its database;
   it does not modify or delete the source.
3. Review the import preflight's free-space result for Cairn's archive, a verified Item Assistant
   source backup, and rotating Cairn backups before confirming the import.
4. Keep live transfers off for the first pass. Collection browsing and Item Assistant import do
   not require Grim Dawn to be running.
5. Do not ask the tester to upload saves, `userdata.db`, the Cairn SQLite archive, or raw live
   queue files. Use the redacted diagnostic export and application logs.

## Clean-machine security pass

Use a fresh Windows 10 or 11 VM with default SmartScreen and Defender settings and no previous
Cairn Codex or Item Assistant installation. Download only from the project release page, verify
the published installer SHA-256, and record the exact SmartScreen publisher/warning text. The
initial beta is intentionally unsigned, so a policy-managed machine may refuse to run it.

After installation, confirm first launch works and that both
`resources\helper\native\ItemAssistantHook_x64.dll` and `DllInjector64.exe` remain present. If
Cairn reports that either file is missing, review **Windows Security > Protection history** and
record the detection name and affected path. Repair or reinstall from the trusted release after
the file is allowed under the tester's normal security policy. Do not disable SmartScreen,
Defender, real-time protection, or third-party endpoint protection globally. If organizational
policy prevents an exception, keep live mode off; collection browsing and closed-game workflows
remain available.

Before attempting live mode, export a redacted support bundle and record the app version, native
fingerprints, VC++ runtime status, and whether the adapter reports available. Then use only the
maintained allowlisted Grim Dawn build and the normal live-transfer checklist. Do not substitute
or rename a quarantined native file.

## First-run observations

- Time from launch to the first usable Collection screen, separately from the time until every
  background job settles.
- Whether Grim Dawn installation, content packs, save modes, and game-data indexing are explained
  without maintainer help.
- Whether “Import from Item Assistant” is discoverable and the selected file is unambiguous.
- Whether the UI remains responsive during source backup, import, roll analysis, and collection
  refresh.

## Import assertions

- Record source copy count, SC/HC split, imported, already present, unsupported/quarantined, and
  total archived copies after import.
- Repeat the same import once. It must add zero copies and must not retain another identical full
  source backup after `IMPORT-02` is complete.
- Restart Cairn and confirm the total and several exact items persist.
- Search common names, an affix, a skill modifier, and an exact seed. Counters and rendered rows
  must agree.

## Scale and navigation assertions

- Scroll Collection, Sets, MI Workshop, Transfers, Supplies, and Leveling Planner while background
  work is active; note any jump, blank region, delayed input, or Windows “Not responding” state.
- Switch repeatedly between Collection, Settings, and Transfers. Settings/Transfers should be
  full-screen system workspaces and Back/Forward should restore the previous tool.
- In Transfers, page through Ingest history, Dispense history, and Quarantined items.
  Histories must remain read-only; only quarantined copies can be selected and returned. No view
  should mount all archived copies.
- Trigger several quick informational messages and one error. The unified notification queue must
  keep them readable without overlap.

## Support handoff

If anything fails, capture:

- the action and approximate local time;
- the visible error or stuck progress stage;
- whether Cairn, Grim Dawn, or Item Assistant was open;
- the redacted support bundle from Settings;
- whether retrying or restarting changed the result.

Do not retry a transfer marked uncertain. Preserve the application data directory and follow
`docs/recovery.md`.
