# Persisted preferences

Cairn Codex renderer preferences live in one versioned document under the
`cairn-codex-preferences` browser-storage key. `preference-repository.ts` is the only module
allowed to interpret older renderer keys or write the canonical document.

## Schema and durability

Version 1 separates settings by purpose:

- `appearance`, `workspace`, and `search` are disposable interface preferences. They include
  the theme, zoom, tracker layout, planner presentation, visible and experimental tools,
  Monster Infrequent tier counting, and remembered explorer choices.
- `planner` and `notes` contain user-authored builds, ignored/favorite records, and to-dos.
- `sources` contains operational choices: collection basis, enabled source paths, retrieval
  stash, and live auto-connect.
- `onboarding` records the current guide version, status, and step.
- `meta.profileKind` distinguishes a genuinely fresh profile from a returning installation
  migrated from legacy keys. This lets fresh defaults remain conservative without hiding tools
  that an existing user already had available.

The interface reset is deliberately narrow. It replaces only `appearance`, `workspace`, and
`search` with fresh defaults. It must preserve `planner`, `notes`, `sources`, and `onboarding`,
and it never accesses the Codex Archive, saves, stashes, backups, queues, or receipts.

## Reads, migration, and diagnostics

Every startup validates the canonical document field by field. Invalid values fall back to a
bounded safe default while unrelated valid fields survive. Diagnostics contain only the load
source, schema version, migration flag, and invalid field paths; they never include preference
values, paths, character names, profile contents, or to-do text.

When no canonical document exists, the repository checks the historical keys and performs one
compatibility migration. Legacy keys are intentionally retained for rollback, but are never
read again after the canonical document has been written.

Changes to this schema require:

1. incrementing the schema version;
2. adding an explicit migration from every supported older version;
3. validating new fields with bounded fallbacks;
4. classifying each new field as interface, user-authored, operational, or onboarding state;
5. extending `test:preferences`, including proof that interface reset preserves durable state.

## Export

Settings can export the canonical JSON document through a validated IPC boundary. The export
contains preferences only—never the archive database, item payloads, saves, queues, receipts,
or backups. It can contain user-authored planner/to-do text and configured local source paths,
so users should treat it as private configuration rather than a public support bundle. The
separate diagnostics export remains the safe artifact for public bug reports.
