# Cairn Codex agent guide

This file is the working contract for coding agents and human contributors. Read it before
changing the repository. More specific `AGENTS.md` files may refine these rules for a subtree;
none currently exist.

## Product and safety context

Cairn Codex is a Windows desktop collection manager for Grim Dawn. It reads installed game
data, imports Item Assistant archives, and can exchange exact item instances with a running
game through a version-verified native hook. Real saves and archives are irreplaceable.

- Preserve fail-closed behavior for unknown game, hook, injector, and helper hashes.
- Never weaken source-hash checks, atomic replacement, reparsing, backup verification, queue
  receipts, operation journals, or Softcore/Hardcore separation.
- Never test mutations against a contributor's personal stash, character, Item Assistant
  database, or live Cairn profile unless that person explicitly requests the exact test.
- Use generated fixtures, temporary directories, and isolated Electron user-data directories.
- Do not launch, close, focus, or otherwise control Grim Dawn or a contributor's running Cairn
  Codex. Start a separate isolated Cairn process only when the test requires it.
- Do not commit game assets, extracted databases, saves, archives, user-data directories,
  credentials, machine-specific paths, generated packages, or diagnostic payloads.

## Source of truth and coordination

GitHub issues are the canonical backlog. `docs/roadmap.md` explains product direction and links
to the live issue queue; it must not become a second status tracker.

Before starting work:

1. Search open issues and read dependencies and acceptance criteria.
2. Assign the issue to yourself and add the `status: in progress` label before editing.
3. Keep one primary issue per branch or task. Name branches `issue-<number>-short-name` when a
   worktree or pull request is used.
4. Record newly discovered, independently actionable work as a separate issue instead of
   silently expanding scope. Link it with `blocked by`, `blocks`, or `follow-up to` wording.
5. Do not have two agents edit the same files for the same issue. Coordinate issue ownership
   first, especially for `App.vue`, `src/main/index.ts`, shared contracts, and database schema.

Close an issue only after its acceptance criteria and stated verification pass. Reference the
issue in commits and pull requests with `Refs #123` while work is incomplete and `Closes #123`
only when the change is genuinely complete.

## Repository map

- `src/main/`: Electron main process, persistence, imports, indexing, and IPC registration.
- `src/preload/`: the typed, deliberately narrow renderer boundary.
- `src/renderer/src/`: Vue UI. `App.vue` is still a large migration target; prefer extracting
  bounded components/composables rather than adding more unrelated state to it.
- `src/shared/`: contracts shared across process boundaries. IPC changes start here.
- `src/helper/`: .NET helper for Grim Dawn data and item serialization.
- `native/`: live-hook and injector sources; changes require compatibility and failure testing.
- `scripts/`: deterministic tests, packaging, audits, and isolated benchmark harnesses.
- `docs/architecture/`: enduring design contracts; update these when a boundary changes.
- `docs/test-matrix.md`: measured compatibility and performance evidence.

## Architecture rules

- The renderer accesses the filesystem, database, and native integration only through the typed
  preload API. Validate IPC inputs in the main process and return typed results.
- Keep long work out of renderer loops. Background jobs use bounded batches, lightweight
  progress messages, cancellation where safe, and at most one full snapshot per committed state.
- Result surfaces must keep a bounded DOM. Use the shared list/grid behavior instead of mounting
  an archive-sized result set.
- Searchable workspaces use `ExplorerToolbar`; specialist headers use `ToolHeader`; item-bearing
  views use the global tooltip pipeline. See `docs/architecture/workspace-ui.md`.
- Persisted settings and schema changes must be versioned, validated, and backwards compatible.
- Preserve exact item payloads even when a view projects only a subset of their metadata.
- Keep experimental write-adjacent features disabled by default until their safety matrix is
  complete.

## Development workflow

The supported development host is Windows x64 with Node.js 22+, .NET 10 SDK, and Git.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run verify
```

- Use `rg`/`rg --files` for discovery and `apply_patch` for focused source edits.
- Preserve unrelated working-tree changes. Never use destructive Git cleanup to make a test pass.
- Run the narrowest relevant checks while iterating, then `npm.cmd run verify` before handoff.
- UI changes require representative empty, normal, and large-data states plus narrow-window and
  keyboard checks. Capture screenshots only from an isolated profile with synthetic data.
- Scale-sensitive work must exercise the generated 20k archive fixture and report timings plus
  rendered row/card counts, not just subjective responsiveness.
- Transfer or persistence work must test rejection, timeout, repeated submission, restart, and
  uncertain outcomes in addition to the happy path.

## Commit and review expectations

Use short imperative commit subjects. Keep generated output and local caches untracked. In the
pull request, state the user-visible outcome, verification performed, scale measurements where
relevant, and the safety invariants affected. Follow `CONTRIBUTING.md` and the pull-request
template for the complete checklist.

