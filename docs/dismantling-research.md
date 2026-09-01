# Inventor dismantling research

Status: previewable as probabilities; not safe to execute.

This note records what CC can derive from the installed Grim Dawn data and where
the game executable remains authoritative. The investigation used the effective
base-game plus expansion records loaded in content-pack order on 2026-09-01.
No save, stash, archive row, or live-game state was changed.

## Installed-data model

The effective dismantling rule is
`records/ui/inventor/dismantlepanel/dismantle_table.dbr`. Fangs of Asterkarn
(`gdx3`) overrides that record and adds the Ascendant reward branch.

| Rule | Effective value |
| --- | --- |
| Iron cost | `itemLevel * 10 + 150` per item |
| Scrap record | `records/items/questitems/scrapmetal.dbr` |
| Scrap count | 3–8 with weights 20/25/25/15/10/5 (expected 4.85) |
| Magical bonus | 55% through `mt_comp_dismantling_a01.dbr` |
| Rare/MI bonus | 90% through `mt_comp_dismantling_b01.dbr` |
| Epic bonus | 100% through `mt_comp_dismantling_c01.dbr` |
| Legendary bonus | 100% through `mt_comp_dismantling_d01.dbr` |
| Ascendant bonus | 100% through `mt_comp_dismantling_e01.dbr` |

The bonus tables form a Master Table → Level Table → Dynamic Table graph.
Level Tables select a branch from the dismantled item's level. Dynamic Tables
then apply `minItemLevelEquation`, `maxItemLevelEquation`,
`targetLevelEquation`, base weights, and the `bellSlope` multipliers to the
candidate records. Blank positive-weight Master Table entries are no-drop
weight, not probability that may be redistributed among named rewards.

CC's simulator now evaluates the arithmetic used by the installed dismantling
tables, applies dynamic-table level limits and bell slopes, and fails closed on
unknown equations, missing candidate levels, cycles, or missing records. The
official Grim Dawn Modding Guide describes the same table hierarchy, level
limits, target level, and bell-slope semantics.

## Eligibility and randomness

The installed tutorial says the Inventor accepts equipment of at least Magical
quality. CC's archive schema currently catalogs Rare/MI, Epic, and Legendary
equipment, so the Dismantling Lab intentionally exposes only that narrower
subset. Faction/supply records, reusable copies, non-catalogued copies, and
copies not in the stored state remain ineligible. Expanding the archive to
Magical equipment is a separate ingestion/schema decision.

The reward graph references item level, rarity, and Ascendant state. It does not
reference the item's affixes or seed. The database provides probabilities, not
the game RNG state, so CC cannot predict the exact material rolled by the real
Inventor. A preview must continue to show expected counts and probability
ranges; it must never create the displayed expectation as if it were an actual
roll.

The table has Dynamite UI fields but no numeric Dynamite-cost field. The current
one-Dynamite-per-item preview matches the real Inventor's established UI
behavior, but the cost is executable behavior rather than an ARZ-derived rule.
It therefore needs a live regression check after a game update before any
mutation feature can rely on it.

## Mutation verdict

Mass dismantling is not mutation-ready:

- The native queue preserves an existing `stackSize`, but its ingest/delivery
  allowlist deliberately rejects components and crafting materials. It cannot
  yet deliver dismantling rewards.
- CC reads `reagents.gst`/`reagents.gsh` for collection state but has no verified
  writer for the account reagent store. Direct editing is out of scope.
- The real Inventor still needs a sacrificial-item matrix covering accepted and
  refused item classes, attached component/augment destruction, one-Dynamite
  debit, level-boundary reward pools, and stack merging/full-inventory behavior.
- Exact source rows and finite Dynamite must be reserved in one journaled
  operation. Infinite Supplies must never waive or recreate Dynamite.
- Generated stacks need idempotent queue identities and receipts. Archive-row
  deletion and Dynamite debit may commit only after every output receipt is
  acknowledged; otherwise the reservation must be restored.

Until those gates pass, the Dismantling Lab remains experimental and read-only.

## Evidence

- Installed ARZ records inspected through CC's read-only helper, including the
  effective dismantling table and its reachable Master, Level, and Dynamic
  tables.
- [Official Grim Dawn Modding Guide](https://www.grimdawn.com/downloads/Grim%20Dawn%20Modding%20Guide.pdf),
  “Item Loot Tables” and “Dynamic Table”.
- [Official Grim Dawn service-NPC guide](https://www.grimdawn.com/guide/gameplay/service-npcs/),
  “Inventor”.
- `self-test-dismantling`, exercised by `npm run test:helper`, covers level
  limits, bell-slope weighting, no-drop weight, disabled limits, cost/scrap
  arithmetic, and fail-closed equation handling without requiring a game
  installation.
