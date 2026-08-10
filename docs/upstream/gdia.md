# Grim Dawn Item Assistant source inventory

## Provenance

- Upstream: <https://github.com/marius00/iagd>
- Commit: `babced1cccd09c60ba0b36cf8c3cfe431910c754`
- Inspected: 2026-08-10
- License: MIT, copyright 2019 marius00

The full upstream license is reproduced in `THIRD_PARTY_NOTICES.md`.

## Imported read-only boundary

The following files were copied from `Parser/Stash` into
`src/helper/CairnCodex.GrimDawn/Gdia/Stash`:

- `DataBuffer.cs`
- `GDCryptoDataBuffer.cs`
- `Block.cs`
- `Item.cs`
- `StashTab.cs`
- `Stash.cs`

Local changes are intentionally narrow: provenance comments, removal of the
`log4net` dependency, nullable/bounds corrections, and parse diagnostics. The
original namespaces remain in place to make future upstream comparisons
straightforward.

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

## Important integration finding

Current GDIA does not use these C# `Write` methods as its production live-item
transfer path. Its injected C++ `ItemAssistantHook` intercepts an item added to
the configured stash, persists an item replica as CSV, and later recreates an
item from an outgoing CSV inside the running game. The C# crypto buffer imported
here implements reading, not encrypted transfer-stash writing.

Consequences for Cairn Codex:

- These files are accepted only as the read-only transfer-stash parser.
- Their write methods are untrusted for production stash mutation until proven
  by round-trip fixtures and byte-level validation.
- Milestones 2 and 3 remain behind the write-safety and transaction interfaces.
- A later decision can select verified atomic file serialization or a narrowly
  maintained live-game hook without changing collection persistence or UI IPC.

## Deferred source areas

- `IAGrim/Parsers/Arz` for higher-level item interpretation.
- `HookDll` only if live-game integration is selected after the read-only MVP.
