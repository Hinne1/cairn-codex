# External tester checklist

Use this checklist for a tester who has real Item Assistant history. Do not send a candidate
until every P0 gate in `docs/roadmap.md` is complete.

## Before the session

1. Record the exact Cairn version or commit and the tester's Grim Dawn version.
2. Ask the tester to close Item Assistant during import. Cairn reads and backs up its database;
   it does not modify or delete the source.
3. Confirm enough free disk space for Cairn's archive, a verified Item Assistant source backup,
   and rotating Cairn backups. Until free-space preflight ships, allow at least twice the size of
   `userdata.db` plus 1 GB.
4. Keep live transfers off for the first pass. Collection browsing and Item Assistant import do
   not require Grim Dawn to be running.
5. Do not ask the tester to upload saves, `userdata.db`, the Cairn SQLite archive, or raw live
   queue files. Use the redacted diagnostic export and application logs.

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
- In Transfers, page through Retrieve, Ingestion history, Retrieval history, and Quarantine once
  `TRANSFER-01` is complete. No view should mount all archived copies.
- Trigger several quick informational messages and one error. The unified notification queue must
  keep them readable without overlap once `NOTICE-01` is complete.

## Support handoff

If anything fails, capture:

- the action and approximate local time;
- the visible error or stuck progress stage;
- whether Cairn, Grim Dawn, or Item Assistant was open;
- the redacted support bundle from Settings;
- whether retrying or restarting changed the result.

Do not retry a transfer marked uncertain. Preserve the application data directory and follow
`docs/recovery.md`.
