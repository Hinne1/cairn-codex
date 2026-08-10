# Cairn Codex

A local-first Pokedex-style collection manager for Grim Dawn Epic and Legendary
items.

## Product direction

- Show both lifetime discovery and currently available collection completion by
  rarity, slot, level, and set.
- Keep every owned item instance while presenting one canonical entry per base item.
- Track an automatically selected best roll and an optional user-pinned favorite.
- Ingest and retrieve real items through Grim Dawn's transfer stash.
- Exclude Monster Infrequents from the first release.

## Architecture

```text
Vue 3 + TypeScript renderer
          |
    typed Electron IPC
          |
Electron main process --- SQLite
          |
   JSON messages over stdio
          |
small .NET helper containing the minimum reused GDIA parser/serializer code
          |
 Grim Dawn game database and transfer stash files
```

The .NET helper owns the Grim Dawn binary-format boundary and performs complete,
verified Grim Dawn file transactions. The Electron main process owns application
lifecycle, file watching, SQLite persistence, and operation orchestration. The
renderer has no direct filesystem or database access.

Write eligibility is represented by a replaceable safety gate. The MVP gate
requires Grim Dawn to be closed. A later live-game gate can use GDIA-derived
game-state detection without changing the transaction, ingestion, retrieval, or
IPC layers. GDIA itself must never be running while Cairn Codex is accessing the
transfer stash.

## Initial support scope

- Personal, local-first Windows application.
- English item data.
- Vanilla Grim Dawn plus locally installed official expansions.
- Local save data; broader save-location support can be added when needed.
- Epic and Legendary items only; Monster Infrequents are deferred.

## Milestones

1. **Read-only scanner**
   - Locate supported Grim Dawn installations and save locations.
   - Parse the game database into a canonical item catalog.
   - Parse transfer stashes without modifying them.
   - Display collection totals, item tiles, sets, and owned copies.
2. **Ingest**
   - Import an item from a designated transfer-stash tab.
   - Persist its complete serialized representation before removing it.
   - Verify backups and round-trip serialization before enabling the operation.
3. **Retrieve**
   - Place a selected owned instance into a designated retrieval tab.
   - Refuse unsafe writes, preserve backups, and verify the resulting stash.
4. **Collection intelligence**
   - Roll breakdowns and aggregate auto-best scoring.
   - Pinned-best selection.
   - Advanced filters, comparisons, and collection presentation.

These four milestones are implemented. The desktop Vault screen exposes the
journaled ingest and retrieval flows: choose a transfer stash, stage supported
items in its final tab, and explicitly confirm the operation. Retrieval remains
deliberately conservative and requires that final tab to be empty.

## Safety invariants

- Read-only is the default mode.
- Every write requires an explicit permit from the configured safety gate.
- The MVP never writes while Grim Dawn is running; live-game support requires a
  safety gate that can prove the stash is not in use.
- Never read or write the transfer stash while GDIA is running.
- Before every write, make a restorable snapshot and validate the source hash.
- Serialize to a temporary file beside the target, flush it, parse and verify
  it, then replace the target atomically.
- Retain timestamped automatic backups independently of the atomic replacement
  fallback.
- Keep a durable operation journal for ingest and retrieval.
- Never delete the only persisted representation of an item as part of a failed
  or unverified operation.

## Reused code

The transfer-stash and game-database access layer will be reduced from the
MIT-licensed [Grim Dawn Item Assistant](https://github.com/marius00/iagd).
Copied files must retain their original copyright and license notices. A source
manifest will record the upstream commit and local modifications.

## Development

Prerequisites:

- Node.js 22 or newer.
- .NET SDK 10.

Install and verify the Electron application:

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd run smoke:desktop
```

Run the desktop application in development mode:

```powershell
npm.cmd run dev
```

Build the Grim Dawn helper:

```powershell
dotnet build .\src\helper\CairnCodex.GrimDawn\CairnCodex.GrimDawn.csproj
```

The renderer communicates only through the narrow API exposed by the preload
script. The helper's versioned newline-JSON protocol is documented in
[`docs/architecture/helper-protocol.md`](docs/architecture/helper-protocol.md).
Collection persistence and its lifetime-discovery boundary are documented in
[`docs/architecture/collection-schema.md`](docs/architecture/collection-schema.md).
