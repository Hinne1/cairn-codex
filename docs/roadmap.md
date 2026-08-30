# Cairn Codex roadmap

This document records larger features that need design and validation before
implementation. It is deliberately separate from the release-readiness list:
none of these ideas may weaken the archive's transactional guarantees.

## Mass Inventor dismantling

**Goal:** select redundant archived equipment, simulate dismantling it through
the Inventor, consume the correct amount of Dynamite, and deliver the resulting
materials to the active character in one safe operation.

This is a high-value feature, but it must not begin as a guessed loot generator.
The first milestone is a read-only dismantling-data inspector that proves what
the installed game database says for each eligible item class and content pack.

### Data questions to resolve

- Locate the Inventor dismantling tables, eligibility rules, material pools,
  quantities, weights, level scaling, and expansion overrides in the installed
  ARZ/database records.
- Determine whether the game rolls results from item level, rarity, affixes,
  seed, or a global random source, and document anything that cannot be
  reproduced exactly.
- Confirm the Dynamite cost rules and which item types the real Inventor refuses.
- Verify whether components, rare crafting materials, and other stackable
  results can be delivered through `GiveItemToCharacter` without corrupting the
  account reagent store or producing invalid stacks.

### Proposed workflow

1. Filter the Archive to dismantle-eligible copies and select exact instances.
2. Show an explicit preview: items consumed, Dynamite required, deterministic
   results or probability ranges, and the destination character.
3. Reserve the selected archive rows and finite Dynamite in one journaled
   transaction. Infinite Supplies must never make Dynamite free.
4. Generate results from the verified installed-game rules and queue stackable
   personal deliveries with exact operation identifiers.
5. Commit the source-item deletion and Dynamite debit only after the game
   acknowledges every output; otherwise restore the untouched reservation.

### Required supporting work

- Track finite Dynamite independently from reusable supplies.
- Extend and test stackable personal-inventory delivery beyond Potion of
  Clarity, including full-inventory and partial-delivery rollback.
- Add idempotent batch receipts so a crash, disconnect, retry, or app exit can
  never duplicate outputs or destroy the source items.
- Add an operation ledger and recovery UI showing exactly what was consumed,
  rolled, delivered, or rolled back.
- Validate the model against repeated real Inventor dismantles before enabling
  mutations. Until validation passes, the feature remains preview-only.

### Non-goals for the first version

- No selling, crafting, or transmuting through the same operation.
- No arbitrary material injection.
- No use of account or character Dynamite that Cairn cannot reserve and debit
  atomically.
