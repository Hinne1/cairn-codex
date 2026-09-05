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
and collection-basis controls render only on Collection itself. They must not be repeated above a
specialist tool, and Collection must not add a second card-based tool launcher beside the application
navigation.

`src/renderer/src/components/WorkspaceSidebar.vue` is the one primary navigation surface on every
route. Collection is first, the user's configured tools follow in their persisted order, and Glossary,
Transfers, and Settings are anchored with the sidebar actions. The active route uses `aria-current="page"`.
Transfers and Settings use the same content canvas as other routes: they never remove, resize, or
replace the sidebar. Browser-style Back/Forward still restores the exact previous typed route.

The sidebar supports a durable expanded/compact preference and collapses to icons at compact viewport
widths without changing that preference. Routes never change the stored or rendered navigation density.
At wide widths the sidebar owns the left application edge; only the content region may be centered or
width-capped, so an outer display gutter can never appear between the viewport and navigation.
Destinations use one coherent, high-contrast stroked icon family. When labels are hidden, every
destination retains its accessible name and exposes that label as a hover and keyboard-focus tooltip.
Hiding the currently open tool returns to Collection; hidden and disabled experimental tools do not
remain reachable. The sidebar itself stays available if collection data is unavailable so Collection,
Glossary, Transfers, Settings, customization, and recovery navigation remain predictable.

The top bar contains identity, history, and live status rather than a second navigation strip. The
Cairn Codex mark and name occupy the upper left and expose link semantics that return to Collection.
Back/Forward remain visually secondary beside the brand. Active-character and game-connection status
occupy the upper right. At the narrowest width the character text may collapse while its status and
accessible details remain available.

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

### Research composition

Skill Explorer and all three Planner views opt into the typed `layout="research"`
composition of `ExplorerToolbar`, approved in #138. It uses the same search, clear,
tips, advanced-query dialog, error and loading controls as the standard layout:

- `before`: domain context, followed by search and always-visible filters;
- results row: one live count, sort selector, shared `SortDirectionButton`, optional `views`;
- `summary`: optional compact domain facts, without duplicating the main count.

Planner skills are always visible and editable inline, including at compact widths.
There is no Edit build mode. Profiles, levels, skill additions/removals, character
refresh and ignored-skill restoration retain session ownership. The shared shell
owns spacing, context-field styling, focus treatment and responsive wrapping;
workspaces supply their domain controls through slots, not parallel toolbar CSS.
Planner keeps one mounted toolbar when changing Table/Journey/MI sources, so the
view switch retains keyboard focus. A workspace-local adapter selects the item or
area query without merging their state. No new App.vue orchestration or preference
schema is required. Other workspaces retain the default standard composition.

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

Dense research tables use a narrower pointer contract: only the prominent item picture queues the
global tooltip. Names, types, actions, and ordinary data cells remain free for reading, selection,
and page scrolling. Moving off the picture schedules the same global dismissal used elsewhere.
Keyboard focus stays on the bounded result row, which keeps `item-tooltip` as its accessible
description without adding the decorative picture as another Tab stop.

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
`DismantlingWorkspace.vue` owns query/filter edits, transient selection and read-only preview state.
The main-process `ArchiveWorkspaceQueries` owns eligibility, structured filtering and duplicate
preservation. Queries return 120 metadata rows per page; `BoundedResultSurface` keeps that DOM bound
while paging. Duplicate selection ranks the whole eligible base/mode group before applying search,
protects its best-scored (otherwise newest) copy, excludes attached extras and caps results at 10,000
IDs. Preview resolves only requested IDs, rejecting duplicates, missing copies and changed eligibility.
`App.vue` supplies typed query/selection/preview adapters and an archive revision, never full-vault
input. The workspace does not reach preload directly or introduce a destructive dismantling path.

Both archive-query workspaces preserve selection across pages and clear it when search, filters,
transfer/character context or archive revision changes. They retain compact selected metadata,
not unseen archive payloads. The remote-page owner discards late results and errors after a new
request, revision or unmount; preview and bulk-selection callbacks have equivalent lifetime guards.

Legacy stash-basis Collection, Planner, Explorer, Oracle and MI comparisons retain their archive
ownership/copy augmentation through `archive-copy-session.ts`. It reads the existing vault API in
250-row pages only while a comparison consumer is active, publishes a complete set, and discards
stale batches on source/mode/revision changes or disposal. Supplies and Dismantling never start
this reader. Those legacy comparison consumers still aggregate all their copies; #158 owns their
further extraction. Supplies carries compact reusable metadata into transfer confirmations so
confirmation wording does not depend on whether a comparison workspace was visited first.

Skill Explorer owns its complete typed route-control snapshot, subject picker, suggestions,
structured result search, availability/rarity/slot filters, sort controls, and paging in
`SkillExplorerWorkspace.vue`. It projects typed skill modifiers into the shared
`ResearchItemTableRow` contract and renders `ResearchItemTable.vue`, the same comparison surface as
Leveling Planner. The table starts at required level ascending and presents item identity, level,
slot, support, skill modifiers, acquisition, and archive/roll context inside its local horizontal
scroller. `skill-explorer.ts` owns deterministic skill indexing,
direct-rank, modifier, and visual-only matching, damage-conversion projection, lower-tier MI base
collapse, and row filtering/sorting. `App.vue` supplies the immutable catalog, shared ownership/icon adapters,
the global immediate-focus and delayed-pointer tooltip adapters, the item-drawer adapter, and the
same skill index used by Leveling Planner.
Route restoration replaces the whole control snapshot; user edits reset to page one without a
watcher overriding a restored page.

Leveling Planner owns its controls, setup dialog, Table/Journey/MI Sources markup, and view-switch
focus restoration in `LevelingPlannerWorkspace.vue`. Its shell-lifetime `leveling-planner.ts`
session owns profiles, level drafts, skills, scoped exclusions, favorites, character discovery,
map selection, route restoration, and preference writes through typed injected adapters. Keeping
the session alive across workspace unmounts preserves drafts and in-flight discovery. `App.vue`
only supplies shared catalog/search/ownership services, navigation, notifications, and global
tooltip/drawer adapters; it does not manipulate individual Planner controls. The session exposes
one typed route snapshot and one restoration method, suppressing profile writes and page/area
reset watchers during restoration. `planner-results.ts` owns pure item matching, sorting,
exclusion filtering, and projection into the shared research rows. Regression tests exercise the
production session with Vue reactivity and the real preference repository, plus a 20k item model.

Leveling Planner projects skill ranks, mastery-wide bonuses, conversions, special and visual
modifiers, blueprint/faction/drop acquisition, archive availability, and roll context into the
same row contract. Table is the default comparison view. Journey reuses those rows as a bounded,
level-ordered timeline with the same picture target and favorite/ignore actions; MI Sources remains
the dedicated spatial view. The typed route and preference vocabulary is `table | journey | map`.
Version-1 links and preferences containing the former `list | grid` values migrate to Table and
Journey respectively. Switching Table/Journey preserves the focused result and brings it back into
the unobscured viewport after the bounded surface remounts.

The shared row contract distinguishes rank, pet, conversion, special, and visual modifiers so
future global damage-type presentation can consume semantic data instead of parsing display text.
Catalog presentation sections carry optional `parentSkills` derived from the game's explicit
`grantedSkills` relationships. Selecting a shapeshift includes modifiers to its granted abilities,
with the ability name retained in the effect text. Rank and modifier extraction enumerates actual
numbered fields, including sparse/high indices. Presentation version 33 refreshes older caches.
Planner header clicks toggle the active direction and reset new columns to ascending. Exclusions
are scoped to the selected profile, not inherited from the historical global ignore list.

`ResearchSkillFx.vue` renders all item-level visual transformation sections ahead of ordinary
modifiers in both the shared table and Journey. FX uses the existing semantic FX badge and named
skills; it is not limited to the currently selected skill or Journey's first ordinary modifier.
Visual-only skills also enter the skill index. The horizontal table scroller does not reserve a
vertical scrollbar gutter, so its final header reaches the rounded right edge. Toolbar composition
unification is tracked in #138, with wide/compact mockup review before material UI changes.

Epic and legendary item names share the protected rarity palette
across cards, research results, tooltips, and copy headings. The supplied game references are epic
`#338CCE` and legendary `#A638FF`; the latter is lifted to `#B653FF` to retain text contrast on CC's
surfaces. Rarity badges use the solid shared card surface so their small text keeps the same
contrast over tinted set cards. Research Table and Journey mark unavailable items using a subtle name fade (96%) and
picture fade (78%). An archived copy, a learned crafting recipe, or an available awakening base
keeps an item at full strength; history alone does not. Planner crafting respects the plan's SC/HC
recipe status. Skill modifiers and controls remain at full opacity, and availability labels retain
the distinction between archived, crafting, awakening, and previously archived.

The global item tooltip remains viewport-bounded and preserves its full descendant text as the item
trigger's accessible description. In research tables, the complete item identity cell is the pointer
trigger; Journey retains its prominent picture trigger. Direct wheel input over the tooltip and wheel
input over its item trigger use the same short, reduced-motion-aware scrolling path. The Settings
preference determines whether input at a tooltip boundary continues into the
workspace (the default) or stays contained until the pointer leaves the preview.
Direct wheel input at a tooltip edge explicitly scrolls the page in continuation mode; it must not
depend on Chromium chaining from a fixed overlay. Item-trigger edge input keeps ordinary native
page scrolling. Both paths retain containment when selected.
Keyboard users use Page Up/Down while the describing item retains focus. Hovering the tooltip cancels
pending dismissal, and horizontal table containment never blocks vertical workspace scrolling.

Supplies owns its typed category, compatible-slot, query, transfer-mode, and page controls plus
its transient keyed selection in `SuppliesWorkspace.vue`. The shared pure `supply-presentation.ts`
owns catalog indexing, faction access and option presentation. Main-process queries group archived
unlocks by record/mode, keep individual potion copies and return 60 options per page plus compact
counts. Bulk boost selection returns only eligible active-mode IDs and metadata. `App.vue` supplies
narrow query/selection/dispense adapters, active-character/transfer readiness and the global tooltip
adapter; the workspace never reaches preload directly. Back/Forward restores typed controls, and
Supplies retains delayed tooltips for pointer and keyboard focus. Exact transfer payloads remain
authoritative in the existing main-process transfer services.

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

Category roll sorts keep unrated items after rated items in either direction;
among unrated entries, collected items precede missing items. An exact reference
copy selected by a scored card is retained in the bounded, optional
`AppHistoryEntry.referenceInstanceKey` session-history field, not in shareable
route hashes. Old entries default to no explicit reference, and unavailable
copies fall back to the saved pin or the normal copy order. Explicit reference
changes replace the current history entry. Category profiles expose overflow
scores through a native keyboard-operable `details`/`summary` disclosure rather
than hover-only text.

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

## Glossary and contextual roll help

Isolated presentation fixtures are routed by `src/main/screenshot-collection.ts`, requiring both
a screenshot destination and a recognized fixture name. MI Workshop and bounded-grid fixtures
retain already source-filtered synthetic copies without importing them into the disposable archive;
Skill Explorer retains its explicit synthetic availability. Ordinary startup and unrecognized
fixtures still use the production archive presenter. Feature verification flags do not select data.
`test:mi-workshop-fixture:electron` exercises 72 synthetic MI combinations at 1,440 and 520px,
mounts at most 50 rows, and checks that archive/source/journal tables remain empty afterward.

Glossary is a permanent, data-independent destination, not an optional collection tool.
`GlossaryWorkspace.vue` renders the entry registry in `workspaces/glossary.ts`; prose does not live
in `App.vue`. Each entry has a stable ID, structured sections, optional native details, and sources.
The typed `glossary` route retains the entry ID, normalizes unknown IDs to `item-rolls`, and rejects
item-drawer state. Entry navigation moves focus to its heading. The contents disclosure reveals
section jump controls, which open calculation details and focus their summary when needed.

Collection, MI Workshop, and copy comparison offer concise roll-help links. Opening help clears
the current drawer without modifying the previous session-history entry or saved reference pin;
Back restores the prior filters and exact viewed copy. Glossary state is not a saved preference.

The initial guide explains model-v9 range quality separately from midrank percentile, deterministic
sampling, fixed-member exclusion, grouped damage ranges, offense families, Elemental damage,
retaliation/pet separation, and exact-template MI limitations. The primary example is `78% (98th)`;
the optional 7/8/9 table illustrates why maximum quality can have an 83rd-percentile rank.
Source links come from `shared/glossary-sources.ts`. The main process opens only those exact HTTPS
URLs in the system browser and denies child windows and all other URLs at that boundary.

`test:glossary` checks routes, examples against production roll-quality functions, source allowlisting,
and content integration. `test:glossary:electron` uses empty and populated synthetic profiles at
1,440 and 520px, testing native keyboard input, heading focus, disclosures, contextual links,
exact-reference Back/Forward, and horizontal overflow. Captures remain in ignored local cache.

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

1. Register an optional tool once in `workspaceToolDefinitions`; the shared sidebar derives its
   visible tools from that single preference source. Permanent system/reference destinations
   belong to the sidebar actions instead and must work without collection data.
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
