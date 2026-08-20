# Grim Dawn Item Assistant source inventory

## Provenance

- Upstream: <https://github.com/marius00/iagd>
- Commit: `babced1cccd09c60ba0b36cf8c3cfe431910c754`
- Inspected: 2026-08-10
- License: MIT, copyright 2019 marius00

The full upstream license is reproduced in `THIRD_PARTY_NOTICES.md`.

## Imported source boundary

The following files were copied from `Parser/Stash` into
`src/helper/CairnCodex.GrimDawn/Gdia/Stash`:

- `DataBuffer.cs`
- `GDCryptoDataBuffer.cs`
- `Block.cs`
- `Item.cs`
- `StashTab.cs`
- `Stash.cs`

The following self-contained files were copied from
`IAGrim/Services/ItemStats/SeedStats` into
`src/helper/CairnCodex.GrimDawn/Gdia/ItemStats`:

- `MinstdRandom.cs`
- `Jitter.cs`
- `ItemStatEngine.cs`

Stash-parser changes are intentionally narrow: provenance comments, removal of the
`log4net` dependency, nullable/bounds corrections, and parse diagnostics. The
original namespaces remain in place to make future upstream comparisons
straightforward.

The seed-stat files receive only provenance comments. Cairn Codex supplies its
own ARZ projection and deterministic percentile wrapper; the GDIA engine remains
isolated from SQLite, Electron, and filesystem writes.

Grim Dawn transfer-stash version 11 adds an affix-reroll counter after the
existing seed-reroll counter in each item. Cairn Codex adds this field for v11.
The layout was read-only validated against a current five-tab v11 stash with
211 items and an empty v5 downgrade stash. Every encrypted block boundary was
validated; neither source file was copied or retained.

The ARZ and ARC algorithms were adapted into the dependency-light readers in
Gdia/GameData. They preserve GDIA's archive order and whole-record replacement
semantics while replacing its DataAccess, logging, WinForms, and image
dependencies with narrow Cairn Codex models. LZ4 block decompression is supplied
by the separately licensed K4os.Compression.LZ4 package.

The game-data path was read-only validated against database.arz and Text_EN.arc
from the base game, GDX1, GDX2, and GDX3. The current installation produces
82,297 overlaid source records, 19,138 English tags, and 3,369 eligible
Epic/Legendary gear records. All six discovered transfer stashes parsed without
warnings; the 211-item Documents stash matched 206 copies (174 unique records),
with its five non-matches correctly outside the Epic/Legendary catalog.

The dormant stash writer was corrected to preserve container version/header
fields and to omit the expansion flag for v4. It emits the zero-key format
already present in the user's valid v5 downgrade stash. In-memory round-trip
validation succeeds for all six discovered v4, v5, and v11 stashes: every known
field is preserved and a second serialization is byte-identical to the first.
The existing zero-key v5 fixture is also byte-identical to its first
serialization. This validation does not enable file writes.

## Important integration finding

Current GDIA does not use these C# `Write` methods as its production live-item
transfer path. Its injected C++ `ItemAssistantHook` intercepts an item added to
the configured stash, persists an item replica as CSV, and later recreates an
item from an outgoing CSV inside the running game. The C# crypto buffer imported
here implements reading, not encrypted transfer-stash writing.

Consequences for Cairn Codex:

- These files remain a narrow, quarantined transfer-stash access layer.
- Their write methods are callable only after semantic/idempotent planning and
  through the app-owned journal, safety gate, backups, source hashes, temporary
  validation, and atomic replacement boundary.
- The v11 serializer has completed a game-accepted two-item ingest and matching
  retrieval while preserving every other stash tab. Both directions retain the
  same journal, backup, source-hash, validation, and atomic-replacement guards.
- A later decision can select verified atomic file serialization or a narrowly
  maintained live-game hook without changing collection persistence or UI IPC.

## Additional imported boundary

Live-game integration now bundles the upstream `HookDll` and injector. The hook
has the Grim Dawn 1.3 `ItemReplicaInfo` layout correction, uses Cairn's isolated
app-data directory, reports the active character, and adds a narrowly-scoped
personal-inventory queue for soulbound faction augments. Exact source changes,
build inputs, binary fingerprints, crash evidence, and allowlisted game targets
are recorded in `docs/live-hook-compatibility.md`.

The one-time GDIA migration reads `PlayerItem` from a hash-verified database
backup and also preserves/imports orphaned incoming queue receipts. Import is
transactional, multiplicity-aware, idempotent, and may be configured to reject
mixed HC/SC or uncatalogued records before commit.
