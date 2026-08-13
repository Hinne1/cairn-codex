# Cairn Codex

A local-first Pokedex-style collection manager for Grim Dawn Epic, Legendary,
and Monster Infrequent items.

## Product direction

- Show both lifetime discovery and currently available collection completion by
  rarity, slot, level, and set.
- Keep every owned item instance while presenting one canonical entry per base item.
- Track an automatically selected best roll and an optional user-pinned favorite.
- Ingest and retrieve real items through Grim Dawn's transfer stash.
- Track Monster Infrequent bases by level tier plus discovered prefix/suffix affixes.
- Build a level-ordered character shopping list from any selected subset of skills.

## Architecture

Live-game mutation is a separate, opt-in Cairn-owned adapter derived from GDIA; see
[`docs/architecture/live-game-adapter.md`](docs/architecture/live-game-adapter.md).

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

Write eligibility is represented by separate adapters. Atomic transfer-stash
file writes require Grim Dawn to be closed. An explicit per-session live adapter
uses a bundled, fingerprint-allowlisted hook and injector to perform the transfer
inside game memory. Item Assistant is not required; if it is still installed, it
must remain closed while Cairn Codex owns that hook and queue.

## Initial support scope

- Personal, local-first Windows application.
- English item data.
- Vanilla Grim Dawn plus locally installed official expansions.
- Local save data; broader save-location support can be added when needed.
- Epic, Legendary, and Monster Infrequent bases; MI affix combinations are managed
  separately in the Workshop.

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

The collection browser also extracts item art from the installed game archives,
uses Grim Dawn rarity colors, and builds game-style catalog tooltips from the
local ARZ/tag data. Catalog tooltips show possible base-item ranges (for example,
`40% – 60% Fire Damage`); the copy-comparison drawer remains the place for actual
seed-applied values.

Search is full-text across item names, sets, stats, skill bonuses, granted-skill
names, and descriptions. Bare terms can be combined, and the following scoped
forms are supported: `name:`, `set:`, `skill:`, `slot:`, `type:`, `rarity:`,
`pack:`, and numeric level expressions such as `level:>=75`.

MI acquisition sources are resolved from the installed ARZ by following the full
item -> loot-table -> monster graph. Cairn also indexes placed game records from
the highest installed `Levels.arc`, associates them with named map regions, and
shows the result in item tooltips. The catalog and map index are cached locally;
database/map timestamps invalidate them after a game update, stash timestamps
trigger an inventory refresh, and Settings offers a manual rebuild command.

The Leveling Planner merges all selected skills into one list of supporting MIs,
Epics, Legendaries, and faction rares up to a configurable level cap (70 by
default). Faction-table traversal preserves the required faction and reputation
tier. Its MI Atlas can show only the selected build's sources or every MI under
the current cap, using corrected MAP9 world-region origins plus an area list;
points represent source regions rather than invented exact monster coordinates.

## Safety invariants

- Read-only is the default mode.
- Every write requires an explicit permit from the configured safety gate.
- Closed-game mode never writes a transfer-stash file while Grim Dawn runs.
- Live mode never rewrites the transfer-stash file; it uses an explicit,
  version-reported in-memory hook handshake and durable queue receipts.
- Never read or write the transfer stash while another stash tool is running.
- Before every write, make a restorable snapshot and validate the source hash.
- Serialize to a temporary file beside the target, flush it, parse and verify
  it, then replace the target atomically.
- Retain timestamped automatic backups independently of the atomic replacement
  fallback.
- Keep a durable operation journal for ingest and retrieval.
- Never delete the only persisted representation of an item as part of a failed
  or unverified operation.

GDIA's apparent live stash reads and writes do not come from ordinary concurrent
file access: its injected native hook intercepts incoming items and recreates
outgoing items inside the running game. Cairn Codex keeps that adapter outside
the collection database and file-transaction core and only enables it after an
explicit confirmation for the current game session.

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

Build a directly launchable Windows folder:

```powershell
npm.cmd run package:win
```

Then run `dist\Cairn Codex-win32-x64\Cairn Codex.exe`. Keep the rest of that
folder beside the executable; it contains Electron and the Grim Dawn helper.

The renderer communicates only through the narrow API exposed by the preload
script. The helper's versioned newline-JSON protocol is documented in
[`docs/architecture/helper-protocol.md`](docs/architecture/helper-protocol.md).
Collection persistence and its lifetime-discovery boundary are documented in
[`docs/architecture/collection-schema.md`](docs/architecture/collection-schema.md).
