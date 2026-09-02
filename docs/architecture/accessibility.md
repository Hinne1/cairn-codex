# Accessibility contract

Accessibility is a behavioral contract, not a final visual-review checkbox. New shared UI must
preserve keyboard operation, focus ownership, perceivable status, and the user's motion preference
before a workspace adopts it.

## Modal focus

Component-owned modal dialogs use `src/renderer/src/modal-focus.ts`. The controller:

- captures the element focused immediately before activation;
- moves focus into the dialog after Vue finishes rendering it;
- wraps forward and reverse Tab navigation across enabled, visible controls;
- redirects programmatic focus that escapes an active modal;
- blocks application-history shortcuts while modal focus is active;
- handles Escape through the dialog's explicit close policy; and
- restores focus after rendering only when the captured target is still connected, otherwise using
  a connected application control as a logical fallback.

Advanced Search supplies its first rule field as the initial target and its trigger as the explicit
restore target. First-run onboarding and Planner setup initially focus their labeled dialog
containers so assistive technology announces their heading and context before the first action.
Their existing Escape outcomes remain unchanged.

The contract gate ratchets private modal implementations: component-owned Advanced Search,
onboarding, and Planner setup must use the shared controller, while the four legacy `App.vue`
dialogs may not increase. Safe-mode recovery, tool customization, collection trivia, and the to-do
list remain the next migration slice under #16.

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
shared-controller adoption, the legacy-dialog debt ceiling, and the reduced-motion override. The
Electron route gates additionally exercise both native Advanced Search and custom Planner
setup dialogs. It wraps Tab and Shift+Tab, attempts to move focus outside each modal, blocks modal
history navigation, verifies listener cleanup and detached-trigger fallback, closes with Escape,
restores the trigger, and verifies viewport containment at 520 px. The custom-dialog gate observes
the exact captured `focusin` registration and requires its matching removal on unmount.

The remaining #16 work is a documented keyboard and assistive-technology audit of Collection,
Transfers, Settings, Sets, Planner, and search; migration of the four App-owned dialogs; and a
single-announcement audit for changing background, transfer, and search status.

## Composite selection and sorting

Editable comboboxes keep DOM focus on their text input while their listbox is open. Arrow-key
movement is exposed with `aria-activedescendant`, every option owns a stable DOM ID, and options do
not add a second set of Tab stops. Sortable grid columns expose `aria-sort` only on the active
column; visual direction glyphs are decorative. Skill Explorer is the reference implementation and
`npm run test:skill-explorer-workspace:electron` verifies focus ownership, long-list scrolling,
keyboard and pointer selection, Escape behavior, unique option IDs, and sort state against the
rendered DOM at wide and compact widths. The focused gate is part of `npm run verify`.
