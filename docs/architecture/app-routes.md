# Application route contract

Cairn Codex keeps renderer navigation in a versioned, serializable route. The route is the
single source of truth for browser history and copied deep links; native form restoration must
not become a second state store.

## Version 1

`src/renderer/src/app-route.ts` defines a discriminated `AppRoute` union for every rendered
workspace. Each member contains:

- `version: 1` and a typed `workspace` discriminator;
- an optional stable catalog `itemRecord` for the comparison drawer;
- only the controls owned by that workspace, such as search, filters, sorting, paging, planner
  profile identity, or transfer section.

The route must never contain collection snapshots, result arrays, observed item payloads,
transfer payloads, or other data that can be recovered from the route's stable identities.
Decoding bounds text, arrays, levels, and page numbers before applying state.

The browser entry wraps the route with the application marker, route version, and a small local
history index. Its URL hash carries the same version, workspace, item identity, and JSON control
object. Existing query parameters such as safe-mode startup flags are preserved. Unknown route
versions, workspaces, malformed JSON, and oversized control payloads are ignored safely; normal
Collection defaults remain available.

## Navigation behavior

- A destination or item transition pushes one entry.
- Editing serializable controls replaces the current entry.
- Back/Forward decodes and applies the route before synchronizing rendered controls.
- `pageshow` reapplies the typed route, and controls that browsers may restore natively are
  explicitly synchronized so the DOM cannot disagree with application state.
- Opening an MI item from Collection and choosing **Open in MI Workshop** preserves the item
  route behind the Workshop destination, so Back returns to the same comparison drawer.

When adding a workspace, add one union member, bounded runtime defaults/decoding, capture and
restore branches in `App.vue`, and a round-trip case in `scripts/test-app-routes.mjs`. New route
fields must be small, serializable controls or stable identities.
