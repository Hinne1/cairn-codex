# Contributing

Cairn Codex is currently preparing for its first public beta. Bug reports and
small, focused changes are welcome. Please discuss broad architecture or live
hook changes before investing substantial work.

## Development checks

Install Node.js 22 or newer and the .NET 10 SDK, then run:

```powershell
npm.cmd ci
npm.cmd run verify
```

The normal CI checks deliberately do not need Grim Dawn installed. The full
desktop smoke suite additionally scans the developer's local installation and
save data:

```powershell
npm.cmd run smoke:desktop
```

Never commit game archives, extracted game art, transfer stashes, character
saves, Cairn databases, live queues, receipts, backups, or diagnostic bundles.
Changes to write orchestration must retain the invariants documented in
`docs/architecture/write-transactions.md`.

## Pull requests

- Keep unrelated work out of the change.
- Run `npm.cmd run verify`.
- Add or update a deterministic test for parsing, persistence, or transfer logic.
- Describe any migration and its rollback behavior.
- Treat native hook and game-version allowlist changes as safety-sensitive.
