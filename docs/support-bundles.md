# Diagnostics and support bundles

Cairn Codex keeps a small structured event log so failures can be investigated without asking
testers for saves, stash files, Item Assistant data, or the Codex archive. Logging is enabled at
a minimal level by default. **Settings → Support and recovery** can temporarily enable debug
logging when a maintainer asks for additional helper timing detail.

## Bounded retention

| Mode | Files | Maximum per file | Maximum age |
| --- | ---: | ---: | ---: |
| Standard | 3 | 256 KB | 7 days |
| Debug | 6 | 1 MB | 14 days |

Rotation and age pruning happen inside the application. Debug logging remains bounded and can be
disabled at any time; disabling it immediately returns to the standard retention policy.

## What an export contains

The redacted JSON support bundle contains:

- Cairn Codex, Electron, Node, Chrome, helper, game, and live-hook versions or fingerprints when
  available;
- SQLite integrity and aggregate archive/journal state;
- aggregate backup and local support-file counts;
- bounded job timings, correlation IDs, recent successful action names, and structured log events;
- aggregate collection state, write-safety results, and a redacted live-adapter summary.

It does **not** contain personal paths, character names, email addresses, credentials, item
payloads, save or stash contents, the archive database, Item Assistant data, transfer
queues, receipts, backups, hook messages, or extracted game assets. Sensitive fields are removed
when an event is written and the complete bundle is redacted again during export.

You should still inspect a support bundle before posting it publicly. Never attach character
saves, stash files, archive databases, crash dumps, or raw live-adapter files to a public issue.
