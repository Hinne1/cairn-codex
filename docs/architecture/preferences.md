# Persisted preferences

Cairn Codex preferences live in one versioned document at `preferences.json` in the Electron
user-data directory. The renderer keeps a browser-storage mirror under `cairn-codex-preferences`
for rollback compatibility, but `preference-repository.ts` and `PreferenceFileStore` are the only
modules allowed to interpret or publish the canonical document.

The main-process file is deliberately renderer-origin independent. On first launch after this
migration, the current `file://` or local development origin is imported without deleting its
legacy browser copy. Each other origin is merged once by stable planner/to-do IDs, then recorded;
it cannot later resurrect a plan the user deliberately deleted from the canonical document.
The provenance list is capped at 32 origins. Once full, an unknown origin uses the durable
document without importing its browser mirror; recorded origins are never evicted, so stale data
cannot regain first-import status.
If a browser mirror has a strictly newer document timestamp than the canonical envelope—for
example, because its preceding file-write IPC failed—it is recovered as the same origin's newest
complete document on the next launch.

## Schema and durability

Version 1 separates settings by purpose:

- `appearance`, `workspace`, and `search` are disposable interface preferences. They include
  the theme, zoom, tracker layout, planner presentation, visible and experimental tools,
  Monster Infrequent tier counting, and remembered explorer choices.
- `planner` and `notes` contain user-authored builds, ignored/favorite records, and to-dos.
  Planner profiles may include a combined class name and its two masteries; older profiles
  without that metadata remain valid and are enriched only when the user creates or edits a plan.
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

Every startup loads the main-process file before mounting Vue, then validates the canonical
document field by field. Recoverable planner objects receive bounded defaults instead of being
silently discarded. Invalid values fall back to a bounded safe default while unrelated valid fields survive. Diagnostics contain only the load
source, schema version, migration flag, and invalid field paths; they never include preference
values, paths, character names, profile contents, or to-do text.

Writes use a compact, byte-bounded envelope, a temporary file, and atomic rename. Reads consume
at most the envelope ceiling plus one detection byte before rejecting an oversized primary. The immediately previous valid envelope is kept,
and changes to planner/to-do content create up to 12 rotating recovery snapshots. Startup falls
back through the previous file and newest valid snapshot if the primary file is corrupt or absent.

When no canonical file exists, the repository checks the historical keys and performs one
compatibility migration. Legacy keys are intentionally retained for rollback and origin imports.

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
