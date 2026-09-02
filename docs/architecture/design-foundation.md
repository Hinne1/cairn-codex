# Design foundation and workspace audit

This document records the migration baseline for the shared design umbrella in issue #45 and
the semantic theme foundation in issue #15. The interaction rules remain normative in
`workspace-ui.md`; this audit identifies where presentation still diverges and orders the work
needed to make those rules visible throughout the application.

## Foundation model

`src/renderer/src/semantic-tokens.css` provides the static Cairn fallback palette, while
`src/renderer/src/semantic-tokens.ts` defines the versioned extension allowlist, resolver, and
runtime application API. The two Cairn representations are kept in sync by the theme contract
test. Tokens are grouped by responsibility rather than by workspace:

- application layers describe canvas, surfaces, overlays, and elevation;
- content tokens describe strong, primary, secondary, muted, and disabled text;
- border, focus, spacing, radius, typography, control, and motion tokens define geometry;
- feedback tokens describe success, warning, danger, and informational states;
- workspace tones alter accent, border, heading, and surface color without changing layout;
- Grim Dawn rarity and gameplay tokens remain separate from application status colors.

Shared components consume those semantic roles. A workspace may choose an existing tone, but
must not carry its own input height, focus ring, button geometry, heading shell, or literal
palette. Alternate themes use the versioned contract in `theme-extension.md`; gameplay colors
remain protected and invalid or inaccessible manifests fall back to the Cairn palette.

## Baseline audit

| Workspace | Shared header | Shared explorer | Global tooltip | Primary deviation to resolve |
| --- | --- | --- | --- | --- |
| Collection | Purpose-built collection summary | Yes | Yes | Preserve its dashboard identity while moving shell, tabs, cards, and states to tokens. |
| Sets | Collection-level heading | Yes | Yes | Keep rarity/readiness semantics; align card density, surfaces, and empty state with shared results. |
| Components & Consumables | Collection-level heading | Yes | Yes | Separate material identity from Collection without inventing another toolbar or card language. |
| Skill Explorer | Yes | Yes | Yes | Tokenize table, picker, and selected-skill hierarchy; adopt shared bounded result behavior. |
| Stash Oracle | Yes | Yes | Yes | Retain green research tone while aligning cards, badges, and loading/empty states. |
| Leveling Planner | Yes | Yes | Yes | Consolidate profile/setup controls and table/card/map result states around shared geometry. |
| MI Workshop | Yes | Yes | Yes | Align comparison metrics and table behavior with the shared result primitive. |
| Supplies | Yes | Yes | Yes | Align selection cards and persistent dispense action with standard batch-action states. |
| Collection Farming | Yes | Yes | Yes | Align route cards and no-location states with shared cards and empty-state language. |
| Dismantling Lab | Yes | Yes | Yes | Preserve experimental/read-only warning while adopting standard selection and preview surfaces. |
| Transfers | Yes | History filters only | Yes | Unify history/quarantine tabs, pagination, notices, loading, and empty states. |
| Settings | Yes | Not applicable | Not applicable | Use the same form controls, card hierarchy, feedback, and responsive geometry without tool chrome. |

Collection and Sets do not need identical information architecture to specialist tools. They do
need the same type scale, surface hierarchy, focus treatment, control geometry, responsive
breakpoints, and status vocabulary.

## Measured acceptance baseline

Issue #58 turned the qualitative audit above into an isolated, repeatable baseline on
2026-09-01. `Pass` means the observed behavior satisfies the current contract. `Follow-up`
means the behavior is usable but does not satisfy the coherent end state. `Deferred` means the
specialist owner has not completed that part of the review; every deferred cell names that
owner rather than hiding work in prose.

All searchable workspaces passed a filter-produced empty state. Normal and scale evidence used
the generated 24,553-copy/5,525-item profile; no contributor profile, game process, save, or
stash was opened. Captures ran at 1,440×1,000 and 520×1,000. The harness now fails when a
requested workspace is hidden or was not opened, can opt experimental tools into its isolated
profile, and reports active workspace, document overflow, and mounted result counts.

| Workspace | Hierarchy and controls | Normal/large result evidence | 520px | Keyboard and tooltip | Disposition |
| --- | --- | --- | --- | --- | --- |
| Collection | Purpose-built dashboard; shared explorer | 5,525 results; 48 cards mounted; empty passed | Pass; no document overflow | Global item tooltip; complete keyboard audit deferred to #16 | Keep the dashboard exception; migrate its manual card cap in #68. |
| Sets | Shared explorer; rarity/readiness semantics remain explicit | **202 of 202 cards mounted**; empty passed | Pass; controls stack without document overflow | Global item tooltip; card audit deferred to #16 | Page cards in #64 after the active set-semantic work in #46. |
| Components & Consumables | Shared explorer | 167 results; 48 cards mounted; empty passed | Pass; no document overflow | Global item tooltip; complete audit deferred to #16 | Replace the manual card cap in #68. |
| Skill Explorer | Shared `ToolHeader`, explorer, and bounded table | 61 current matches/50 mounted; 120/50 deterministic fixture; empty passed | Follow-up: 1,220px local table scroller | Focus tooltip and bounded Arrow/Home/End/paging passed | Give the table a deliberate narrow representation in #63. |
| Stash Oracle | Shared header/explorer with experimental gating | 3,148 archetypes/12 cards mounted at explicit Lv1–100; empty passed | Pass; no document overflow | Global item tooltip; complete audit deferred to #16 | Replace the manual 12-card cap in #68. |
| Leveling Planner | Shared header/explorer; setup controls remain specialist | 44/44 current results; 120/50 table and card fixtures; empty passed | Follow-up: 1,250px local table scroller | Focus tooltip, bounded keyboard, actions, and history passed | Resolve narrow table behavior in #63; extraction remains #17. |
| MI Workshop | Shared header/explorer and bounded table | 1,774 combinations/50 mounted; empty passed | **Fail: document expands to 657px** | Focus tooltip and bounded keyboard/paging passed | Fix toolbar/document overflow in #63. |
| Supplies | Shared header/explorer and explicit batch/live state | 22 current cards mounted; empty passed; local cap is 60 | Pass; no document overflow | Global item tooltip; batch keyboard audit deferred to #16 | Move keyed selection to the shared surface in #68. |
| Collection Farming | Shared header/explorer | **214 of 214 route cards mounted**; empty passed; no-match search took 497.4ms including debounce | Pass; no document overflow | Global item tooltip; complete audit deferred to #16 | Page route cards and retain rank semantics in #65. |
| Dismantling Lab | Shared header/explorer; read-only status is explicit | 24,509 candidates/120 mounted by local cap; empty passed | Pass; no document overflow | Selection/preview audit remains with experimental owner #25 and keyboard owner #16 | Do not fork the active #25 prototype; its eventual result migration must use the shared contract. |
| Transfers | Focused system workspace; three explicit sections | 24,609 history operations/50 mounted; empty passed | Pass; no document overflow | Shared paging/navigation passed; final audit remains #16 | Preserve the focused shell and server-paged contract. |
| Settings | Focused system workspace; no explorer by design | Form state; result paging not applicable | **Fail: document expands to 785px** | Form/dialog audit deferred to #16 | Fix grid/header/action overflow in #63. |

The rich Collection dashboard remains exclusive to Collection. #102 replaces the former split
dashboard-card/specialist-rail model with one adaptive persistent sidebar for Collection and its
tools, while retaining the cards as descriptive dashboard shortcuts. Transfers and Settings stay
focused system workspaces. #17 remains the code-ownership migration.

The remaining result migrations are intentionally split by collision domain: #64 owns Sets,
#65 owns Farming, #68 owns the mature manually capped card tools, and #25 retains Dismantling.
#63 owns responsive geometry and narrow data presentation. #16 remains the single final owner
for focus, keyboard, reduced-motion, and assistive-technology acceptance across all workspaces.

## Migration order

1. Move shared `ToolHeader`, `ExplorerToolbar`, advanced search, semantic badges, import status,
   application shell, and system navigation onto semantic tokens.
2. Ratchet literal palette debt downward. Shared components permit no literal colors; the
   legacy global stylesheet may only decrease from its recorded ceiling.
3. Introduce the shared bounded list/grid behavior in issue #21, including loading, empty,
   error, selection, keyboard, paging, and virtualization states.
4. Migrate workspaces in focused slices, coordinating component extraction with issue #17.
5. Complete the keyboard, focus, reduced-motion, and assistive-technology audit in issue #16.
6. Extend alternate themes only through the versioned manifest and fallback contract; never add
   theme-identifier branches or workspace-local palettes.

## Visual acceptance matrix

Every migrated workspace is checked with synthetic or generated data in these states:

- empty data and filter-produced empty results;
- representative normal data;
- large data with a bounded mounted result count;
- loading, recoverable error, disabled action, and success/warning feedback where applicable;
- wide desktop and 520-pixel narrow layouts;
- keyboard traversal, visible focus, Escape behavior, and focus restoration;
- item hover/focus tooltips, internal wheel scrolling, and held-detail behavior where relevant.

The final issue #45 review compares all workspaces in one matrix so local improvements cannot
hide a new cross-tool inconsistency.

## Enforcement

`npm run test:theme-contract` verifies required semantic roles and runtime/CSS fallback parity,
exercises manifest versioning and fail-closed contrast behavior, protects gameplay semantics,
rejects literal colors in every Vue component, and prevents the remaining `styles.css` palette
debt from increasing. The ceiling is intentionally a migration ratchet, not an approved design
API. Lower it whenever literal values are replaced and remove it once `styles.css` is fully
semantic.
