# Accessibility contract

Accessibility is a behavioral contract, not a final visual-review checkbox. New shared UI must
preserve keyboard operation, focus ownership, perceivable status, and the user's motion preference
before a workspace adopts it.

## Modal focus

Component-owned modal dialogs use `src/renderer/src/modal-focus.ts`. The controller:

- captures the element focused immediately before activation;
- moves focus into the dialog after Vue finishes rendering it;
- wraps forward and reverse Tab navigation across enabled, visible controls and scrolls the
  newly focused control into view;
- redirects programmatic focus that escapes an active modal;
- repairs focus after a focused control is removed, disabled, or hidden, without recapturing the
  original invoker; native details/summary controls participate in ordinary Tab order;
- blocks application-history shortcuts while modal focus is active;
- handles Escape through the dialog's explicit close policy; and
- restores focus after rendering only when the captured target is still connected, otherwise using
  a connected application control as a logical fallback.

Advanced Search supplies its first rule field as the initial target and its trigger as the explicit
restore target. First-run onboarding and Planner setup initially focus their labeled dialog
containers so assistive technology announces their heading and context before the first action.
Their existing Escape outcomes remain unchanged.

Advanced Search, onboarding, Planner setup, startup recovery, tool customization, collection
trivia, the to-do list, and copy comparison all use the shared controller. Body and document-root
focus are not usable invokers. Trivia can disappear while opening an item; comparison then restores
a surviving application control. Changing the inspected record preserves the original return target.

## Reduced motion

`semantic-tokens.css` owns the global `prefers-reduced-motion: reduce` response. It disables smooth
scrolling, collapses transitions, and lets every finite or repeating animation complete once in
effectively zero time. This includes older hard-coded spinners and entrance animations that do not
yet consume the transition token. Loading and connection state must still be conveyed by text or
semantic status, never by motion alone.

JavaScript scrolling uses `preferredScrollBehavior()` so the same media preference changes smooth
Collection jumps to immediate movement. CSS cannot override a `window.scrollTo()` behavior option,
so direct hard-coded smooth scrolling is rejected by the accessibility contract.

## Verification

`npm run test:accessibility` checks focus-cycle edge cases, escape containment, restoration guards,
shared-controller adoption, and the reduced-motion override. The
Electron route gates additionally exercise both native Advanced Search and custom Planner
setup dialogs. It wraps Tab and Shift+Tab, attempts to move focus outside each modal, blocks modal
history navigation, verifies listener cleanup and detached-trigger fallback, closes with Escape,
restores the trigger, and verifies viewport containment at 520 px. The custom-dialog gate observes
the exact captured `focusin` registration and requires its matching removal on unmount.

`npm run test:accessibility:electron` adds native Chromium keyboard input and accessibility-tree
checks at 1,440px and 520px (125% zoom), plus compact startup recovery. Its generated collection contains
ordinary items, set members, an Epic/awakened pair, and scored physical copies. It exercises dialog
opening, Tab wrapping, middle-summary traversal, focus repair after record replacement and to-do
deletion, Escape, outside-focus containment, and restoration after the invoker disappears.

| Core workflow | Keyboard audit and complementary full-verification coverage |
| --- | --- |
| Collection | Bounded 48-card grid, Arrow/Home traversal, comparison opening and return; the existing Collection/grid gates also cover paging and stable record identity. |
| Transfers | All three section controls activate with Enter; existing Transfers route tests cover filters, return-mode controls, empty-action gating, and history restoration. No live transfer is part of this audit. |
| Settings | Navigation, native checkbox activation, persisted debug-logging action and its status message in the disposable profile; existing Settings tests cover display/source controls and safe-mode restrictions. |
| Sets | A member opens comparison with Enter and receives focus back; the existing bounded Sets gate covers 50/202 cards, paging, filtering, empty state and history. |
| Planner | Table, Journey and MI Sources activate with Enter; existing Planner gates cover setup, row actions, bounded results and view-switch focus. |
| Search | Collection normal/empty/reset states preserve input focus; Advanced Search traps/restores focus; invalid Supplies and Dismantling queries retain one error announcement owner. |

These checks inspect the actual Chromium accessibility tree and live-region DOM contract. They do
not claim a listening test with NVDA, JAWS or VoiceOver; speech timing remains dependent on the
screen reader and its settings.

## Status announcements

Notification polite (`status`) and assertive (`alert`) containers remain mounted before messages
arrive. Exactly one channel is populated for each announcement. Keyed message content supports
new notifications with identical text, while the notification service suppresses identical
coalesced repeats. The visual growl has no second live role. This follows W3C's
[status technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22) and
[alert technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA19).

Background jobs announce their phase label; per-item counters remain readable in the visible
banner without repeating the phase. Explorer result counts use one atomic output region. Query
errors belong to ExplorerToolbar; Supplies and Dismantling keep their result error visible with
`announceError=false` while a query error exists. Independent load errors still announce from the
result surface. The native audit verifies real Settings notifications and injected, presentation-only
background progress; `test:notifications` covers deduplication, priority and assertive delivery.

## Composite selection and sorting

Editable comboboxes keep DOM focus on their text input while their listbox is open. Arrow-key
movement is exposed with `aria-activedescendant`, every option owns a stable DOM ID, and options do
not add a second set of Tab stops. Sortable grid columns expose `aria-sort` only on the active
column; visual direction glyphs are decorative. Skill Explorer is the reference implementation and
`npm run test:skill-explorer-workspace:electron` verifies focus ownership, long-list scrolling,
keyboard and pointer selection, Escape behavior, unique option IDs, and sort state against the
rendered DOM at wide and compact widths. The focused gate is part of `npm run verify`.

Viewport-bounded item tooltips keep focus on the describing item so assistive technology retains the
full item-detail description. Pointer users can enter the tooltip and wheel its visible scrollbar;
keyboard users can use Page Up/Down while the item stays focused. The shared direction-aware wheel
policy honors Display's page-continuation/containment preference at overflowing boundaries. Short
tooltips always permit page scrolling. Shift/horizontal input stays available to research tables;
ordinary wheel input elsewhere remains with the page. Leaving both source and tooltip dismisses it
after the shared grace period.

Escape keeps tooltips dismissed while the pointer stays still, including when removing the overlay
uncovers its source. Moving within that source resumes the normal hover delay; moving elsewhere
discards the old request. A new keyboard focus change also permits inspection again. The shared
dismissal controller is covered by the real-pointer/keyboard version gate at 1,440px and 520px.

Keyboard focus opens descriptions immediately, retaining the source anchor while its focus event
is active. Pointer hover retains the shared 180ms delay.
All item sources forward wheel input through the same `tooltip-scroll.ts` policy; the complete
entry-point inventory lives in `workspace-ui.md`. Farming and Planner MI Sources expose the same
description on their existing item buttons, and Oracle evidence buttons also name `item-tooltip`.
`test:tooltip-scroll` covers pixel/line/page modes, fractional deltas, queued edges and repeated
reversals. `test:tooltip-scroll:electron` checks tooltip and page offsets with native input across
Collection, Skill Explorer, Planner Table and Journey, and MI Workshop at both widths and both boundary settings,
plus focused Page Up/Down, short content and reduced motion. It runs in full verification.

Original/Awakened tooltip versions switch with V while the describing item stays focused.
Pointer users can click the version summary, including while a search field retains focus;
the duplicate pointer shortcut does not move focus into the tooltip or add a Tab stop.
The summary names its counterpart and says “Click or press V.” Typing, composition, held-key
repeats, and Ctrl/Meta/Alt combinations do not activate the V shortcut. Missing counterparts
have no switch affordance. `npm run test:tooltip-versions:electron` covers both input paths
through the real global tooltip at wide and compact widths.
