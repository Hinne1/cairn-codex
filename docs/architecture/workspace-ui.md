# Workspace UI contract

Cairn Codex workspaces share one interaction vocabulary even when their data is different.
This avoids each new tool inventing its own search bar, filter placement, result count, and
responsive behavior.

Presentation roles and the workspace migration audit are defined in `design-foundation.md`.
Shared UI consumes `semantic-tokens.css`; literal workspace palettes and workspace-specific
control geometry are not part of this contract.

Alternate palettes use the versioned resolver documented in `theme-extension.md`. Components
must not branch on `data-theme`; they continue to consume the same semantic roles.

## Workspace shell

Collection is the rich home dashboard. Its archive summary, refresh action, completion trackers,
collection-basis controls, and full customizable tool launcher render only on Collection itself.
They must not be repeated above a specialist tool.

Specialist tools use `src/renderer/src/components/WorkspaceSwitcher.vue` immediately below the
persistent system navigation. The switcher keeps Collection and tool customization fixed while
the visible tool destinations occupy one bounded horizontal rail. The active destination uses
`aria-current="page"` and scrolls into view when the route changes. Hiding the currently open
tool returns to Collection; hidden and disabled experimental tools do not remain reachable from
the rail. Transfers and Settings remain focused system workspaces and do not render either
Collection launcher.

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

At compact widths the toolbar becomes one vertical control flow: search, filters, sorting,
actions, then the result count. Controls may wrap or stack, but their labels and meanings must
not disappear. `Search tips` is a viewport-layer overlay rather than content that widens its
workspace; it clamps to the visible viewport, closes on Escape, and restores focus to its
summary. `Advanced search` follows the same containment and focus-restoration contract.

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
- `list`, `grid`, and CSS-table layouts share the same result model. Selectable and interactive
  surfaces use roving focus with Arrow keys, Home, End, Enter, and Space. Grid surfaces derive
  the visible column count from rendered rows unless a fixed keyboard column count is required.
- A dense comparison table may retain its useful desktop columns at compact widths only inside
  a labeled local horizontal scroller. That region must receive keyboard focus, expose a visible
  scrolling hint, retain the identity column while scrolling where practical, and must never
  widen the document itself. Do not squeeze field names into ambiguous abbreviations merely to
  avoid a local scrollbar.
- Selection is keyed by domain identity and may survive sorting or paging when the owning tool
  permits it. A workspace must clear selection explicitly when its safety rules require that.

Transfers operation history and quarantine are the first server-paged adopters. Quarantine uses
the shared multi-selection model while retaining its fail-closed transfer controls. MI Workshop
is the first local CSS-table adopter: it mounts 50 affix combinations per page, exposes the
existing affixed item tooltip on pointer hover and keyboard focus, and opens the item on Enter,
Space, or click. Skill Explorer uses the same local table pattern for item-to-skill comparisons,
including its rank, conversion, special-modifier, and level sorts. Leveling Planner uses one
bounded result window for both its table and card modes; favorites and ignored-base controls stop
row activation and remain keyed to item records. Grid navigation derives its column count from
the rendered row so ArrowUp and ArrowDown remain correct as the responsive card grid reflows.
Collection and Components & Consumables mount 48 item cards per page through the same grid
contract. Stash Oracle retains its ranked 12-card page and uses navigation-only grid focus so
its nested planning and inspection actions remain explicit. Supplies mounts 60 options per page,
retains selected record keys across paging, and uses per-record disabled state so unavailable
augments cannot enter the transfer selection even through card or keyboard activation.
The measured cross-workspace baseline and remaining focused migration owners live in
`design-foundation.md`; do not reopen #21 as a broad catch-all when one workspace-sized issue is
sufficient.

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

## Workspace ownership and extraction

`App.vue` is the application shell, not the long-term owner of tool-local query, filter, paging,
grouping, or result markup. Extracted workspace routes own those concerns in a bounded component
and a focused view-model module. The shell supplies immutable catalog data and narrow adapters
for genuinely global behavior such as item presentation, tooltip routing, and opening the shared
item drawer. Extracted workspaces must not create a second tooltip portal or reach through the
preload boundary independently.

Collection Farming is the first migrated route. `CollectionFarmingWorkspace.vue` owns edits to
its search, rarity filter, page reset, and bounded result surface; `collection-farming.ts` owns
deterministic missing-item grouping, filtering, deduplication, and ranking. `App.vue` supplies
catalog items, the typed route-control snapshot used by global Back/Forward history, and the shared
search-document, icon, content-pack label, tooltip, and item-drawer adapters. Restoring a typed route
replaces the complete control snapshot, while user query or rarity edits reset paging inside the
workspace. This is the reference seam for later incremental route extraction while #17 remains open.

Stash Oracle follows the same seam. `StashOracleWorkspace.vue` owns archetype generation, search,
class/style/readiness/level filters, sorting, paging, and result cards; `stash-oracle.ts` owns the
pure filtered-and-sorted view projection plus immutable control mutations. `App.vue` retains only
the typed route-control snapshot, preference persistence, planner navigation, and adapters for the
global tooltip and item drawer. A restored route preserves its requested page, while user edits to
search or filters reset the workspace to page one.

## Semantic badges and Grim Dawn rarity

Compact state labels use `src/renderer/src/components/SemanticBadge.vue` and the variables in
`src/renderer/src/semantic-tokens.css`. Epic and Legendary accents must come from the shared
rarity tokens; completion, current ownership, recipes, awakening qualifications, and visual FX
must use distinct semantic tones instead of workspace-local pill styles.

Collection completion and qualified readiness are separate concepts. A learned recipe or an
owned awakening base may qualify a missing set piece for readiness, but neither counts as that
piece being discovered. Surfaces must name those qualifications explicitly.

## Adding a workspace

1. Register the route in the shared Collection launcher and focused workspace switcher.
2. Use `ToolHeader` for the workspace heading.
3. Use `ExplorerToolbar` if the result set is searchable or filterable.
4. Keep query, filters, sorting, and result count reactive from the same source of truth.
5. Route item hover/focus through the global tooltip pipeline.
6. Use `BoundedResultSurface` for a result set that can exceed one bounded page.
7. Add an isolated screenshot interaction for any new control shape.
8. Verify keyboard focus, narrow layouts, empty results, restored history state, and absence of
   document-level horizontal overflow. For deliberately wide tables, also verify the labeled
   local scroller and its focus treatment.
9. Declare the workspace once in `src/shared/search-schema.ts`; parser options, Search tips, and
   Advanced search controls must consume that same definition.
