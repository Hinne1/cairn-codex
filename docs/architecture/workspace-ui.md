# Workspace UI contract

Cairn Codex workspaces share one interaction vocabulary even when their data is different.
This avoids each new tool inventing its own search bar, filter placement, result count, and
responsive behavior.

## Explorer toolbar

Searchable workspaces use `src/renderer/src/components/ExplorerToolbar.vue`.

- Search is always first and always has an inline clear action.
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

## Search and filter semantics

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

## Adding a workspace

1. Use `ToolHeader` for the workspace heading.
2. Use `ExplorerToolbar` if the result set is searchable or filterable.
3. Keep query, filters, sorting, and result count reactive from the same source of truth.
4. Route item hover/focus through the global tooltip pipeline.
5. Add an isolated screenshot interaction for any new control shape.
6. Verify keyboard focus, narrow layouts, empty results, and restored history state.
