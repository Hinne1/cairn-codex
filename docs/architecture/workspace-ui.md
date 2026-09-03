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

Collection, Transfers, and Settings form one stable system-navigation strip in the top bar on every
route. Collection is the active system destination while its dashboard or any specialist child tool
is open. Activating it returns to the Collection dashboard; browser-style Back/Forward still restores
the exact previous typed route. Transfers and Settings retain their focused full-screen treatment.

Collection specialist tools share `src/renderer/src/components/WorkspaceSidebar.vue` as a child-tool
navigation model. The user's visible tools use the same configured order as the dashboard shortcuts,
and the active child route uses `aria-current="page"`. The sidebar supports a durable expanded/compact preference and collapses
to icons at compact viewport widths without changing that preference. At wide widths the sidebar
owns the left application edge; only the content region may be centered or width-capped, so an
outer display gutter can never appear between the viewport and navigation. Destinations use one
coherent, high-contrast stroked icon family. When labels are hidden, every destination retains its
accessible name and exposes that label as a hover and keyboard-focus tooltip. Hiding the currently
open tool returns to Collection; hidden and disabled experimental tools do not remain reachable.

The Collection dashboard retains its customizable tool cards as descriptive quick access, not as
a second primary navigation system. It omits a redundant Collection card. The sidebar contains only
child tools and never duplicates the Collection system destination. Transfers and Settings render
neither the sidebar nor dashboard launcher, but keep the same system destinations in the same order.

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
- Passive visual-card grids expose `list` / `listitem` semantics. Interactive, navigable, and
  selectable card grids expose the complete `grid` / `row` / `gridcell` ownership chain, with
  roving focus, selection, disabled state, and descriptions attached to the focusable gridcell.
  CSS-table results retain their existing `grid` / `row` / `gridcell` structure.
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

Dismantling Lab keeps its read-only safety boundary while following the same ownership model.
`DismantlingWorkspace.vue` owns query and filter edits, transient copy selection, safe-duplicate
selection, progressive disclosure, preview state, and result/preview markup; `dismantling.ts` owns
pure eligibility, structured filtering, and duplicate-preservation policy. `App.vue` supplies the
typed route-control snapshot, immutable vault-item input, a narrow preview adapter, and the shared
redacted-error formatter. The workspace never reaches the preload API directly, and no destructive
dismantling path is introduced by the extraction.

Skill Explorer owns its complete typed route-control snapshot, subject picker, suggestions,
structured result search, availability/rarity/slot filters, sort controls, paging, and dense-table
markup in `SkillExplorerWorkspace.vue`. The table starts at required level ascending and presents
item identity, ranks, damage conversion, special modifiers, and visual transformations as distinct
columns inside its local horizontal scroller. `skill-explorer.ts` owns deterministic skill indexing,
direct-rank, modifier, and visual-only matching, damage-conversion projection, lower-tier MI base
collapse, and row filtering/sorting. `App.vue` supplies the immutable catalog, shared ownership/icon adapters,
the global immediate-focus and delayed-pointer tooltip adapters, the item-drawer adapter, and the
same skill index used by Leveling Planner.
Route restoration replaces the whole control snapshot; user edits reset to page one without a
watcher overriding a restored page.

The global item tooltip remains viewport-bounded and preserves its full descendant text as the item
trigger's accessible description. Ordinary wheel input scrolls only when targeted at overflowing
tooltip content; keyboard users use Page Up/Down while the describing item retains focus. Hovering
the tooltip cancels pending dismissal, while wheel input elsewhere continues to scroll the workspace.

Supplies owns its typed category, compatible-slot, query, transfer-mode, and page controls plus
its transient keyed selection in `SuppliesWorkspace.vue`. `supplies.ts` owns reusable-unlock
counting, catalog presentation indexing, archived-copy identity, faction-reputation access,
structured search, and deterministic option projection. `App.vue` supplies immutable catalog and
archive inputs, active-character and transfer readiness, one global-tooltip adapter, and one
narrow dispense callback; the workspace never reaches the preload API directly. Category and slot
changes clear selection, query edits preserve selection while resetting page one, transfer-mode
changes clear selection, and Back/Forward restores the complete typed control snapshot. Supplies
retains its established delayed tooltip behavior for both pointer and keyboard focus.

MI Workshop owns its typed query, affix-quality filter, selected comparison metric, sort, direction,
page, reserve disclosure, shared toolbar, and complete bounded comparison table in
`MiWorkshopWorkspace.vue`. `mi-workshop.ts` owns exact base/prefix/suffix grouping, the affix rarity
index, strict rare-prefix plus rare-suffix filtering, structured base/affix/stat/skill matching,
metric leadership, and deterministic group sorting. `App.vue` retains one typed Back/Forward
control snapshot, the shared comparison drawer, and narrow catalog/icon/global-tooltip/item-drawer
adapters. Keyboard focus opens the affixed copy tooltip immediately; pointer hover keeps the
established delay. Changing a user-facing query, filter, metric, or sort resets paging, while route
restoration replaces the complete snapshot without a watcher erasing the restored page. Page-only
changes update the bounded result window without invalidating the archive grouping projection.

Collection and Components & Consumables share one extracted catalog workspace without sharing
control state. `CollectionMaterialsWorkspace.vue` owns each route's query, ownership/category/
rarity filters, sort, page reset, category rail, 48-card bounded result surface, and card markup;
`collection-materials.ts` owns deterministic category, ownership, recipe, strict double-rare,
structured-query, and sorting projection. `App.vue` keeps two complete typed control snapshots so
switching between Collection, Materials, and Sets cannot leak filters or paging across tools. The
shell retains Collection's dashboard, completion trackers, and tool launcher plus narrow adapters
for search documents, category progress, global tooltips, item drawers, and live retrieval. Route
restoration replaces the appropriate snapshot, while user edits reset only that route to page one.
Raw query edits enter typed route history immediately, while the expensive catalog projection uses
a workspace-owned 120 ms debounce and cancels pending work on unmount.

Settings is a focused system workspace rather than a searchable explorer. `SettingsWorkspace.vue`
owns its fourteen configuration cards, Item Assistant entry point, tool-visibility form, archive
scope presentation, MI counting controls, backup/support presentation, and all control labeling.
`settings.ts` owns the pure onboarding-status, archive-mode, formatting, and workspace-tool
definition model used by both the route and Collection's customization entry point. `App.vue`
retains preference state and narrow effect adapters for preload operations, confirmation dialogs,
notifications, collection refresh, safe-mode restart, and live delivery. Settings never reaches the
preload bridge directly. Its MI counting and retrieval target models continue to update the same
shell-owned persisted refs, so extraction does not create a second preference source of truth.

Transfers is also a focused system workspace, but its archive mutations remain deliberately
outside the route component. `TransfersWorkspace.vue` owns the ingest/dispense/quarantine section
navigation, structured history and quarantine controls, bounded remote result presentation,
return-mode presentation, keyed quarantine selection, and disabled-action policy. `transfers.ts`
owns one typed session shared by route history, the workspace, and shell service adapters plus pure
operation formatting and search-error projection. `App.vue` retains archive queries, live/offline
delivery, quarantine release, safety refreshes, recovery coordination, notifications, and
confirmation/preload boundaries behind five narrow callbacks. The workspace never reaches the
preload bridge and historical operations remain noninteractive.

## Semantic badges and Grim Dawn rarity

Dialog focus, reduced-motion behavior, and the remaining keyboard-audit debt are specified in
`docs/architecture/accessibility.md`. Workspace-owned dialogs must use the shared modal focus
controller instead of adding local Tab/Escape/restore implementations.

Compact state labels use `src/renderer/src/components/SemanticBadge.vue` and the variables in
`src/renderer/src/semantic-tokens.css`. Epic and Legendary accents must come from the shared
rarity tokens; completion, current ownership, recipes, awakening qualifications, and visual FX
must use distinct semantic tones instead of workspace-local pill styles.

Collection completion and qualified readiness are separate concepts. A learned recipe or an
owned awakening base may qualify a missing set piece for readiness, but neither counts as that
piece being discovered. Surfaces must name those qualifications explicitly.

## Adding a workspace

1. Register the route once in `workspaceToolDefinitions`; the shared sidebar and Collection
   shortcuts must derive their visible destinations from the same preference.
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
