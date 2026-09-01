# Workspace UI contract

Cairn Codex workspaces share one interaction vocabulary even when their data is different.
This avoids each new tool inventing its own search bar, filter placement, result count, and
responsive behavior.

Presentation roles and the workspace migration audit are defined in `design-foundation.md`.
Shared UI consumes `semantic-tokens.css`; literal workspace palettes and workspace-specific
control geometry are not part of this contract.

## Semantic foundation

- Use application-layer tokens for canvas, surfaces, overlays, borders, text, focus, controls,
  spacing, radii, elevation, status, and motion.
- Workspace tone changes may alter accent, heading, border, and surface color, but never control
  geometry, typography hierarchy, focus behavior, or responsive layout.
- Grim Dawn rarity and gameplay colors are semantic data and remain separate from application
  success, warning, error, ownership, readiness, and experimental states.
- Shared Vue components contain no literal color values. The legacy global stylesheet is a
  ratcheted migration surface and must only move toward semantic tokens.

## Explorer toolbar

Searchable workspaces use `src/renderer/src/components/ExplorerToolbar.vue`.

- Search is always first and always has an inline clear action.
- Every search provides a short explanation of its indexed fields and click-to-apply examples
  through the shared `Search tips` disclosure. Examples must only advertise syntax and fields
  that the workspace actually supports.
- Every search also exposes the shared `Advanced search` dialog. It emits canonical query text
  into the normal search input and never owns a second filter state.
- Filters describe which records are included.
- Sort controls describe how the included records are ordered.
- Batch actions come after filters and sorting.
- The live result count is always visible and uses the noun appropriate to the workspace.
- Native browser form restoration must not make a control disagree with Vue state.

Tool-specific selectors and unusual controls belong in the toolbar slots. They should not
reimplement its outer layout, input styling, focus treatment, clear button, result count, or
responsive breakpoints.

Collection, Sets, Components & Consumables, Skill Explorer, Stash Oracle, both Leveling
Planner result modes, MI Workshop, Supplies, Collection Farming, Dismantling Lab, and the
Transfers archive browser currently use this contract. Settings and configuration forms do not
use an explorer toolbar because they do not represent a searchable result set.

## Tool headers

Specialist workspaces use `src/renderer/src/components/ToolHeader.vue` for their eyebrow,
title, explanation, optional status summary, and primary view controls. Tone variants may carry
the workspace's identity, but spacing, hierarchy, typography, and responsive behavior stay
shared. Do not add another workspace-specific heading shell.

## Bounded result surfaces

Result-heavy workspaces use `src/renderer/src/components/BoundedResultSurface.vue` with the
pure paging and keyboard model in `src/renderer/src/bounded-results.ts`.

- Local collections pass the complete filtered array; the shared surface slices it to the
  configured page size before mounting rows or cards.
- Database-backed collections pass one server page with `remote`, `totalCount`, and the same
  page size. The surface still refuses to mount more than one page if an endpoint over-delivers.
- Every record supplies a stable, unique domain key. Array positions are not keys; duplicate
  keys are contract failures.
- Loading, empty, error/retry, range, and pagination presentation stay in the shared surface.
  Workspaces customize the item slot and may customize state copy, but must not fork state or
  paging behavior.
- `list`, `grid`, and CSS-table layouts share the same result model. Selectable surfaces use
  roving focus with Arrow keys, Home, End, Enter, and Space; grid callers declare the keyboard
  column count used by row navigation.
- Selection is keyed by domain identity and may survive sorting or paging when the owning tool
  permits it. A workspace must clear selection explicitly when its safety rules require that.

Transfers operation history and quarantine are the first server-paged adopters. Quarantine uses
the shared multi-selection model while retaining its fail-closed transfer controls. MI Workshop,
Planner, and Skills migrations are tracked incrementally under #21 so each change can be
visually and behaviorally verified without an `App.vue` flag-day rewrite.

## Search and filter semantics

- Every searchable workspace compiles its query through
  `src/shared/search-query.ts`. Do not split terms manually or introduce a
  tool-local query grammar.
- Whitespace is implicit `AND`. Explicit `AND`, `OR`, parentheses, quoted
  phrases, `NOT`, and the `-term` shorthand are supported. Precedence is
  `NOT`, then `AND`, then `OR`.
- Fields, aliases, value kinds, common values, help, and builder controls come from
  `src/shared/search-schema.ts`. Parser options and Search tips are derived from that schema;
  workspace-local copies are not allowed. Unknown fields and invalid numeric comparisons
  produce an inline error and preserve the unfiltered result surface while the user edits.
- `src/shared/advanced-search.ts` translates between the shared expression tree and a flat rule
  form. Syntax outside that form's representable subset stays visible as a preserved clause and
  must never be silently discarded.
- Numeric fields accept equality or `>=`, `<=`, `>`, and `<`. Boolean fields
  accept `true`/`false` and `yes`/`no`.
- Large persisted collections use the same parsed expression tree translated
  to parameterized SQLite predicates. Renderer-only collections evaluate a
  typed `SearchDocument`; neither path may interpolate user values into SQL.
- Search matches the visible subject and its useful metadata, not only its display name.
- A subject picker (for example, the skill combobox) is separate from searching the result set.
- Filters combine with search using AND semantics.
- Sorting never changes which records are present.
- A displayed "best" or leader copy is selected independently from the order of result groups.
- Empty states explain whether no data exists or the current controls produced no matches.

## Item tooltips

All item-bearing workspaces use the single global item-tooltip pipeline in `App.vue`:
`queueTooltip`, `moveTooltip`, `scheduleTooltipHide`, and the `item-tooltip` presentation.
Affixes are passed through the same pipeline as copy context. Do not add workspace-local item
tooltip markup; extend the shared presentation contract when a new stat or section is needed.

The tooltip remains global because only one hover target can be active at a time and because
mouse-wheel scrolling, viewport placement, held details, affix composition, and item links must
behave identically everywhere.

## Semantic badges and Grim Dawn rarity

Compact state labels use `src/renderer/src/components/SemanticBadge.vue` and the variables in
`src/renderer/src/semantic-tokens.css`. Epic and Legendary accents must come from the shared
rarity tokens; completion, current ownership, recipes, awakening qualifications, and visual FX
must use distinct semantic tones instead of workspace-local pill styles.

Collection completion and qualified readiness are separate concepts. A learned recipe or an
owned awakening base may qualify a missing set piece for readiness, but neither counts as that
piece being discovered. Surfaces must name those qualifications explicitly.

## Adding a workspace

1. Use `ToolHeader` for the workspace heading.
2. Use `ExplorerToolbar` if the result set is searchable or filterable.
3. Keep query, filters, sorting, and result count reactive from the same source of truth.
4. Route item hover/focus through the global tooltip pipeline.
5. Use `BoundedResultSurface` for a result set that can exceed one bounded page.
6. Add an isolated screenshot interaction for any new control shape.
7. Verify keyboard focus, narrow layouts, empty results, and restored history state.
8. Declare the workspace once in `src/shared/search-schema.ts`; parser options, Search tips, and
   Advanced search controls must consume that same definition.
