# Cairn Codex product and architecture roadmap

This document explains the product direction and architecture themes that cross individual
fixes. The live, assignable backlog is maintained in
[GitHub issues](https://github.com/Hinne1/cairn-codex/issues); issue labels and milestones are
the source of truth for status, ownership, and dependencies.

The IDs below remain stable planning references while the corresponding GitHub issues carry
their current state. Priority **P0** is required before handing a build to a new external
tester; **P1** is beta-quality work; **P2** is longer-term architecture or product expansion.

## External tester gates

| ID | Priority | Status | Work | Acceptance criterion |
| --- | --- | --- | --- | --- |
| SCALE-01 | P0 | done | Exercise a 20,000-copy Item Assistant import in an isolated profile. | Mixed SC/HC import, verified source backup, repeat-import deduplication, unsupported records, and source immutability all pass. |
| SCALE-02 | P0 | done | Replace 24-at-a-time roll hydration that rebuilds and retransmits the full archive after every batch. | Roll analysis is a bounded background job with lightweight progress; a 20k archive never performs O(n²) snapshot work and remains responsive. |
| SCALE-03 | P0 | in progress | Page or virtualize copy-heavy views and query them without mounting the entire archive. | Transfers, retrieval history, ingestion history, quarantine, and any copy list keep a bounded DOM and meet the performance budgets below with 20k+ copies. |
| SCALE-04 | P0 | planned | Separate startup instrumentation into cached first paint, interactive, scan settled, and roll-analysis settled. | Diagnostics and performance tests report each phase so a usable cached screen is not confused with a completed background refresh. |
| DIAG-01 | P0 | planned | Add structured rotating application logs and a one-click support bundle. | A tester can export redacted logs, app/game/helper versions, hashes, job timings, last navigation/action, database integrity, and operation correlation IDs without exposing item payloads or character names. |
| IMPORT-01 | P0 | planned | Add an Item Assistant preflight and progress flow. | Before import, show source path, copy count, SC/HC split, unsupported estimate, backup size, required free space, and destination mode; during import, show named progress stages and a durable result. |
| IMPORT-02 | P0 | planned | Deduplicate and retain Item Assistant source backups by content hash. | Repeating an unchanged import does not retain another full `userdata.db`; retention is bounded and every retained backup remains hash-verifiable. |
| ONBOARD-01 | P0 | done | Add guided first-run onboarding. | A new user can locate Grim Dawn, choose “Import Item Assistant” or “Start empty,” understand archive versus live transfer, and reach Collection without reading the README. The tour can be skipped and reopened. |
| RECOVERY-01 | P0 | planned | Perform and record the remaining live-transfer release matrix. | Full target, repeated submit, Cairn exit, stale receipt, and unsupported-build tests have explicit results for the shipped hashes. |

### Measured 20k findings (2026-09-01)

- 20,000 supported copies imported in **818 ms**; a repeat import completed in **493 ms**
  without duplicates. The synthetic source remained unchanged and both backups verified.
- A packaged isolated 24,514-copy profile reached the benchmark-ready Collection in
  **41.5 seconds**, versus roughly 34 seconds for the existing capture profile; ordinary
  Collection search remained about **153 ms including the 150 ms wait**.
- Opening unfiltered Transfers mounted **14,509 rows** and took about **1.8 seconds** just to
  switch workspaces. This is functional but not an acceptable bounded UI.
- Background roll hydration scored only 96 of 20,002 newly unscored copies during the captured
  run. The current 24-copy loop reloads, projects, serializes, and sends the entire archive for
  every batch. This is the most important pre-tester performance defect.

## Product foundation

| ID | Priority | Status | Work | Acceptance criterion |
| --- | --- | --- | --- | --- |
| SHELL-01 | P1 | done | Treat Settings and Transfers as full-screen system workspaces. | Collection progress and tool launchers do not appear inside either system workspace; Back returns to the previous tool. |
| FEATURE-01 | P1 | done | Centralize feature maturity and experimental-tool visibility. | Stash Oracle and Dismantling Lab are off for new profiles, preserved for existing users, clearly labelled experimental, and enabled from Settings. |
| COUNT-01 | P1 | done | Surface archive scale. | The home view shows total currently archived copies alongside catalog-entry counts. |
| NOTICE-01 | P1 | done | Replace independent snackbar refs/timers with one notification service. | Notifications are queued or coalesced, never overlap, use stable severity/action semantics, remain accessible, and preserve important transfer/recovery messages until dismissed. |
| TRANSFER-01 | P1 | planned | Redesign Transfers around operations rather than one long page. | Tabs are **Retrieve**, **Ingestion history**, **Retrieval history**, and **Quarantine**. History comes from the operation journal, supports search/paging, and keeps SC/HC, seed, time, outcome, and correlation ID. |
| SEARCH-01 | P1 | planned | Build one shared query parser and search-document contract. | Every ExplorerToolbar supports implicit AND, explicit `AND`/`OR`, quoted phrases, negation, and documented fields such as `skill:`, `damage:`, `slot:`, `rarity:`, `level:`, `owned:`, and `affix:` where meaningful. |
| SEARCH-02 | P1 | planned | Add an inline search guide and examples. | Help is reachable from every search bar, explains scope for the current tool, and can insert example queries such as `skill:wendigo AND "vitality damage"`. |
| SETS-01 | P1 | planned | Bring Sets onto the shared visual hierarchy. | Epic versus Legendary is obvious at card and list level; level, completion, craftability, awakening, and FX changes use shared badges/tokens; sorting and keyboard behavior match other tools. |
| PLANNER-01 | P1 | planned | Redesign Leveling Planner creation. | “New plan” offers Blank, Character save, and Clone; users choose masteries/build identity, skills, and level range in a short guided flow, then edit through a compact consistent toolbar. |
| THEME-01 | P1 | research | Establish design tokens before adding themes. | Spacing, type, surfaces, rarity colors, statuses, focus, and control geometry are CSS variables/components; default theme is coherent before alternate themes are exposed. |
| A11Y-01 | P1 | planned | Complete keyboard, focus, reduced-motion, and screen-reader review. | Dialog focus is trapped/restored, virtualized rows remain keyboard reachable, status changes are announced once, and every workflow works without a mouse. |

## Architecture consolidation

The shared toolbar/header work exposed the next structural boundary. `App.vue` is currently
about 7,900 lines, the global stylesheet about 1,200 lines, and the main process about 3,900
lines with 35 IPC handlers. Shared visuals alone cannot prevent behavioral drift while state,
queries, jobs, and persistence remain in those monoliths.

| ID | Priority | Status | Work | Acceptance criterion |
| --- | --- | --- | --- | --- |
| ARCH-01 | P1 | planned | Split renderer workspaces into route components and composables. | App shell owns navigation, notifications, tooltip portal, and global jobs; each tool owns a bounded view-model with no cross-tool template branches in `App.vue`. |
| ARCH-02 | P1 | planned | Split main-process IPC registration into services. | Archive, import, collection, live transfer, diagnostics, backup, and window lifecycle have isolated modules and tests; IPC handlers only validate and delegate. |
| ARCH-03 | P1 | planned | Centralize persisted preferences. | One versioned settings repository replaces scattered localStorage access, validates migrations, supports reset/export, and distinguishes profile defaults from returning-user compatibility. |
| ARCH-04 | P1 | planned | Introduce a background-job contract. | Scan, roll hydration, import, backup, icon extraction, and map indexing report typed progress, support cancellation where safe, avoid duplicate jobs, and survive navigation. |
| ARCH-05 | P1 | planned | Add a shared data-grid/list primitive. | Paging/virtualization, selection, empty/loading/error states, keyboard navigation, and stable record keys are tested once and reused by Transfers, MI Workshop, Planner, Skills, and histories. |
| ARCH-06 | P2 | planned | Replace ad-hoc history state with typed routes. | Deep links and Back/Forward restore a workspace and serializable controls without storing large transient data or manually syncing native form restoration. |
| ARCH-07 | P1 | planned | Add renderer error boundaries and safe mode. | A failed tool cannot blank the app; users can reopen with experimental tools disabled and reset UI preferences without touching the archive. |
| ARCH-08 | P2 | planned | Define the theme API. | Components consume semantic tokens only; no new tool adds literal palette values outside the theme layer. |

## Performance and reliability budgets

These become automated gates using generated archives, not personal data.

- 20k Item Assistant import: under 15 seconds excluding source-copy time, with stage progress.
- Warm startup to usable Collection: under 5 seconds; cold game-data indexing is reported as a
  separate background stage.
- Tool switch with 20k copies: under 250 ms to first useful paint.
- Search/filter response: under 100 ms compute and under 200 ms perceived latency.
- DOM rows/cards per result surface: bounded (target 100–250), regardless of archive size.
- Background work: no task may serialize the full archive more than once per committed snapshot.
- Memory: record main/renderer private working set at 5k, 20k, and 50k copies and fail on large
  regressions.
- Every import/transfer/restore starts with a database `quick_check`, free-space preflight where
  files are copied, and a correlation ID that appears in UI history and diagnostics.

## Mass Inventor dismantling

**Goal:** select redundant archived equipment, simulate dismantling it through the Inventor,
consume the correct amount of Dynamite, and deliver the resulting materials to the active
character in one safe operation.

This remains experimental and preview-only until installed-game probabilities and live mutation
semantics are verified. It must not become a guessed loot generator.

### Data questions to resolve

- Locate the Inventor dismantling tables, eligibility rules, material pools, quantities, weights,
  level scaling, and expansion overrides in the installed ARZ/database records.
- Determine whether the game rolls results from item level, rarity, affixes, seed, or a global
  random source, and document anything that cannot be reproduced exactly.
- Confirm Dynamite costs and which item types the real Inventor refuses.
- Verify stackable-result delivery without corrupting the account reagent store or producing
  invalid stacks.

### Required mutation workflow

1. Select exact eligible archive instances and show item/component/augment consequences.
2. Preview Dynamite required and deterministic results or probability ranges.
3. Reserve source rows and finite Dynamite in one journaled operation. Infinite Supplies must
   never make Dynamite free.
4. Queue exact stackable outputs with idempotent batch receipts.
5. Commit deletion and Dynamite debit only after every output is acknowledged; otherwise restore
   the reservation.

The operation ledger, batch recovery, full-inventory behavior, and repeated real-Inventor
validation are prerequisites. Selling, crafting, transmuting, and arbitrary material injection
remain out of scope.
