# Live hook compatibility

Cairn Codex treats injection as a fail-closed capability. A hook may be loaded
only when both its SHA-256 and the running game's `Game.dll` SHA-256 are in the
code allowlist. File versions alone are not sufficient.

## Crash evidence

The installed GDIA retail hook `1.5.9688.8602` crashed Grim Dawn `1.3.0.6`
while an item was dropped into the watched shared stash tab.

- Installed hook SHA-256:
  `14e57644d5403819aebfb856053f28afbc40dcdc2d95d0d9a8c71eafdf707891`
- Exception: access violation `0xc0000005` at `Game.dll+0x16274`
- Exception thread: `34936`
- The captured stack returns directly to the hook's item-replica call at
  `ItemAssistantHook_x64.dll+0x3b2c6`.
- No incoming queue receipt was written and Cairn Codex did not commit a live
  transaction. The on-disk stash hash remained unchanged.

The GDIA source notes that retail Grim Dawn 1.3 added two dwords to
`ItemReplicaInfo`; an undersized structure lets `GetItemReplicaInfo()` write
past the hook's stack object.

## App-owned hook build

The bundled hook is built from the MIT GDIA source at commit
`babced1cccd09c60ba0b36cf8c3cfe431910c754` with its retail 1.3 layout check:

```cpp
static_assert(sizeof(ItemReplicaInfo) == 0x190,
    "ItemReplicaInfo layout does not match retail Grim Dawn FOA v1.3");
```

Build inputs:

- Visual C++ toolset: `v143`
- Windows SDK: `10.0.22621.0`
- Boost: `1.78.0`
- Boost source SHA-256:
  `090cefea470bca990fa3f3ed793d865389426915b37a2a3258524a7258f0790c`
- Hook version: `1.5.9719.17000`
- Hook SHA-256:
  `3280adfefa5a041e1b6bcb8bb4730ca1928b603ebaf811bef5fc653eeb2e6df7`
- Injector SHA-256:
  `569e6bdde51148b29aece0491366e9aa4c21cf2f11279a94c815e2b958cfe10c`

The only additional hook source change redirects `GetIagdFolder()` from GDIA's
local-app-data directory to `%APPDATA%\cairn-codex\live-adapter`. This isolates
Cairn's settings, queues, replicas, and hook log from any existing or removed
Item Assistant installation.

Allowlisted targets:

- Grim Dawn: `1.3.0.6` (x64)
- `Game.dll` SHA-256:
  `d91c184b65ace035672403a00eb7ba4f67dc506e635b6090d77c1d54b91e48d7`
- Grim Dawn: `1.3.0.7` (x64), Steam build `24742013`
- `Game.dll` SHA-256:
  `4a746c1e455d30e4c95a591eeead77f03d6187cd66aa1e3191ee25fb25a419aa`

The allowlist entry means the corrected binary layout and Cairn Codex queue
contract were verified for an exact target. Live ingest and retrieval have both
completed with committed durable receipts on `1.3.0.6`. On `1.3.0.7`, injection,
the worker handshake, status inspection, disconnect signaling, and game-process
survival were verified on 2026-08-15 without opening either item queue. The
first item round trip remains a release follow-up. Live mode remains explicitly
opt-in because it mutates the running game process.
