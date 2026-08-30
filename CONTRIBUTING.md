# Contributing to Cairn Codex

Thank you for helping improve Cairn Codex. This project handles real Grim Dawn
items and save-adjacent files, so correctness and recoverability matter more than
speed of delivery.

## Before opening an issue

- Search existing issues and the in-app to-do list.
- Confirm the problem on the newest private beta build.
- For live-transfer problems, stop transferring and preserve the application
  data directory before retrying.
- Do not upload character saves, transfer stashes, the Cairn database, queue
  payloads, receipts, crash dumps, or paths containing personal information to a
  public issue.

The in-app diagnostic export is the preferred starting point. It intentionally
omits item payloads and save contents.

## Development setup

Use Windows x64 with Node.js 22+, the .NET 10 SDK, and Git for Windows.

```powershell
npm.cmd ci
npm.cmd run verify
```

For installed-game integration checks:

```powershell
npm.cmd run smoke:desktop
```

This smoke suite uses an in-memory database and disposable transaction fixtures.
Never point test code at a writable personal stash unless the test is explicitly
part of the documented manual live matrix.

## Change guidelines

- Keep the renderer behind the typed preload API. It must not gain direct
  filesystem or database access.
- Preserve fail-closed behavior for unknown game, hook, and injector hashes.
- Do not weaken source-hash checks, atomic replacement, reparsing, backup
  verification, queue receipts, or journal transitions.
- Treat SC and HC identity as part of every stored item and operation.
- Keep full item serialization intact even when a UI feature uses only a subset.
- Do not commit extracted Grim Dawn databases, archives, icons, maps, saves,
  personal application data, credentials, or machine-specific paths.
- Retain upstream copyright and MIT notices in reused GDIA-derived code.

## Pull-request checklist

- [ ] The change is focused and documented.
- [ ] `npm.cmd run verify` passes.
- [ ] UI changes were checked at multiple window sizes and zoom levels.
- [ ] Database changes are idempotent when a profile is reopened.
- [ ] Transfer changes include rejection, timeout, retry, and uncertain-outcome
      behavior—not only the happy path.
- [ ] No personal data, game assets, secrets, generated packages, or local caches
      are tracked.
- [ ] Relevant architecture, compatibility, or recovery documentation is updated.

## Commit style

Use short imperative subjects, for example:

```text
Preserve queued delivery state across restart
```

Explain safety-sensitive reasoning in the commit body when the diff alone does
not make the invariant obvious.
