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
- Hook version: `1.5.9719.16086`
- Hook SHA-256:
  `5b2b6da0319dcbc8b41bbaef68d6ed09f494737edfcde41011917803c1ba1ac0`

Allowlisted development target:

- Grim Dawn: `1.3.0.6` (x64)
- `Game.dll` SHA-256:
  `d91c184b65ace035672403a00eb7ba4f67dc506e635b6090d77c1d54b91e48d7`

The allowlist entry means the corrected binary layout and Cairn Codex's offline
queue contract were verified for this exact target. It does not claim the live
ingest/retrieval test has passed; live mode remains explicitly opt-in until both
directions complete without a crash and their receipts are verified.
