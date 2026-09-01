# Design foundation and workspace audit

This document records the migration baseline for the shared design umbrella in issue #45 and
the semantic theme foundation in issue #15. The interaction rules remain normative in
`workspace-ui.md`; this audit identifies where presentation still diverges and orders the work
needed to make those rules visible throughout the application.

## Foundation model

`src/renderer/src/semantic-tokens.css` is the only renderer palette source. Tokens are grouped
by responsibility rather than by workspace:

- application layers describe canvas, surfaces, overlays, and elevation;
- content tokens describe strong, primary, secondary, muted, and disabled text;
- border, focus, spacing, radius, typography, control, and motion tokens define geometry;
- feedback tokens describe success, warning, danger, and informational states;
- workspace tones alter accent, border, heading, and surface color without changing layout;
- Grim Dawn rarity and gameplay tokens remain separate from application status colors.

Shared components consume those semantic roles. A workspace may choose an existing tone, but
must not carry its own input height, focus ring, button geometry, heading shell, or literal
palette. Alternate themes override tokens only after the default Cairn theme is coherent.

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

## Migration order

1. Move shared `ToolHeader`, `ExplorerToolbar`, advanced search, semantic badges, import status,
   application shell, and system navigation onto semantic tokens.
2. Ratchet literal palette debt downward. Shared components permit no literal colors; the
   legacy global stylesheet may only decrease from its recorded ceiling.
3. Introduce the shared bounded list/grid behavior in issue #21, including loading, empty,
   error, selection, keyboard, paging, and virtualization states.
4. Migrate workspaces in focused slices, coordinating component extraction with issue #17.
5. Complete the keyboard, focus, reduced-motion, and assistive-technology audit in issue #16.
6. Define alternate theme manifests and fallbacks in issue #24 only after the Cairn theme is
   visually coherent.

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

`npm run test:theme-contract` verifies required semantic roles, rejects literal colors in
shared Vue components, and prevents the remaining `styles.css` palette debt from increasing.
The ceiling is intentionally a migration ratchet, not an approved design API. Lower it whenever
literal values are replaced and remove it once `styles.css` is fully semantic.
