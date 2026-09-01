# Searching Cairn Codex

Cairn Codex uses the same search language throughout Collection, Sets, Skill Explorer,
MI Workshop, Supplies, the planners, farming tools, and Transfers. Each workspace searches
different fields, but the grammar is identical.

Open **Search tips** beside any search box for examples tailored to the current workspace, or
choose **Advanced search** to build the same syntax with a form. This guide covers both paths
and provides recipes you can adapt.

## Visual query builder

Choose **Advanced search** beside **Search tips** to add repeatable rules without memorizing
field names or operators. The available fields and suggested values change with the active
workspace. Select **All of these rules** for `AND`, or **Any of these rules** for `OR`; use
**is not** to add an explicit exclusion. Numeric fields offer **is**, **at least**, and **at
most**.

The **Query preview** shows the exact text that will be placed in the normal search box. Apply
runs it immediately, after which the text remains editable, copyable, and shareable. **Cancel**
leaves the current search untouched, while **Reset** clears the builder draft.

For example, these form rules:

- Skill · exact phrase · `Wendigo Totem`
- Level · at least · `75`
- Rarity · is not · `epic`

produce:

```text
skill:"Wendigo Totem" AND level:>=75 AND NOT rarity:epic
```

When an existing query contains nested or mixed Boolean groups the form cannot safely flatten,
the dialog displays it as a **Preserved query**. Applying additional rules keeps that clause
intact; nothing is silently removed. Use **Reset** only when you deliberately want to replace it.

## Quick start

Plain words search all useful text indexed by the current workspace:

```text
wendigo vitality
```

Whitespace means `AND`, so both terms must match. Use a field when you know which property
you mean:

```text
skill:wendigo AND damage:vitality
```

Use quotes when a value contains spaces:

```text
name:"bloodsworn codex"
```

Queries are case-insensitive. `WENDIGO`, `Wendigo`, and `wendigo` are equivalent.

## Query language

| Feature | Example | Meaning |
| --- | --- | --- |
| Implicit AND | `wendigo vitality` | Match both words. |
| Explicit AND | `skill:wendigo AND damage:vitality` | Match both expressions. |
| OR | `slot:amulet OR slot:medal` | Match either expression. |
| Grouping | `(slot:amulet OR slot:medal) AND level:>=75` | Control how expressions combine. |
| Quoted phrase | `"vitality damage"` | Match the phrase rather than two separate terms. |
| Fielded phrase | `name:"bloodsworn codex"` | Search one field for a phrase. |
| Negation | `NOT rarity:epic` | Exclude matches. |
| Short negation | `-damage:aether` | Shorthand for `NOT damage:aether`. |
| Number comparison | `level:>=75` | Compare a numeric field. |
| Boolean | `owned:true` | Match a yes/no field; `yes` and `no` also work. |

Operator precedence is `NOT`, then `AND`, then `OR`. Parentheses are recommended whenever a
query mixes `AND` and `OR`:

```text
(skill:wendigo OR skill:briarthorn) AND damage:vitality
```

Without the parentheses, `skill:wendigo OR skill:briarthorn AND damage:vitality` means
`skill:wendigo OR (skill:briarthorn AND damage:vitality)`.

Numeric fields support `=`, `>`, `>=`, `<`, and `<=`. Omitting the operator means equality:

```text
level:94
level:>=75
copies:>1
seed:3100000000
```

## Useful recipes

### Find build support

Legendary or Epic amulets and medals that mention Wendigo and Vitality damage:

```text
(slot:amulet OR slot:medal) AND skill:wendigo AND damage:vitality AND (rarity:legendary OR rarity:epic)
```

High-level items supporting either Briarthorn or Hellhound, without Aether-focused results:

```text
(skill:briarthorn OR skill:hellhound) level:>=75 -damage:aether
```

Missing level-94 Legendaries:

```text
rarity:legendary level:94 owned:false
```

### Inspect Monster Infrequents

Bloodsworn Codex combinations with Vitality support:

```text
name:"bloodsworn codex" AND damage:vitality
```

Copies with either a Devouring prefix or an `of the Wild` suffix:

```text
prefix:devouring OR suffix:"of the wild"
```

Retained combinations with more than one copy that do not mention Aether damage:

```text
copies:>1 -damage:aether
```

The MI Workshop's **Affix quality** filter still applies. For example, select **Double rares
only**, then use the search box for the skill or damage profile you want.

### Find supplies

Armor augments providing Aether resistance:

```text
slot:armor AND effect:"aether resistance"
```

Supplies available to the active character from Homestead:

```text
faction:homestead eligible:true
```

Movement runes or difficulty merits:

```text
category:rune OR category:merit
```

### Search transfer history

Hardcore operations imported from Item Assistant:

```text
source:"item assistant" AND mode:hardcore
```

Failed or unresolved operations:

```text
outcome:failed OR state:needs_recovery
```

Find an exact operation from a support report:

```text
id:gdia-import-700000000
```

`correlation:` is an alias for `id:` and `date:` is an alias for `time:`.

## Fields by workspace

Fields that do not make sense for a workspace are deliberately rejected. This catches typos
instead of silently returning misleading results.

| Workspace | Available fields | Numeric fields |
| --- | --- | --- |
| Collection, Sets, Components & Consumables | `name`, `set`, `skill`, `damage`, `slot`, `type`, `rarity`, `pack`, `level`, `owned` | `level` |
| Skill Explorer | `name`, `skill`, `damage`, `stat`, `slot`, `rarity`, `level`, `conversion`, `owned` | `level` |
| Stash Oracle | `name`, `class`, `mastery`, `skill`, `damage`, `style`, `set`, `item`, `readiness`, `score` | `score` |
| Leveling Planner | `name`, `type`, `slot`, `rarity`, `skill`, `damage`, `source`, `area`, `level`, `owned` | `level` |
| Collection Farming | `name`, `skill`, `damage`, `monster`, `source`, `area`, `rarity`, `level` | `level` |
| MI source atlas | `name`, `area`, `item`, `monster`, `source`, `pack`, `level` | `level` |
| MI Workshop | `name`, `slot`, `level`, `prefix`, `suffix`, `affix`, `skill`, `damage`, `stat`, `copies` | `level`, `copies` |
| Supplies | `name`, `category`, `effect`, `faction`, `slot`, `source`, `mode`, `eligible` | — |
| Dismantling Lab | `name`, `base`, `prefix`, `suffix`, `affix`, `rarity`, `mode`, `level` | `level` |
| Stored copies and Quarantine | `name`, `base`, `prefix`, `suffix`, `affix`, `slot`, `rarity`, `level`, `seed`, `mode`, `pack` | `level`, `seed` |
| Ingestion and Retrieval history | `item`, `name`, `base`, `seed`, `outcome`, `state`, `id`, `mode`, `source`, `time` | `seed` |

Leveling Planner also accepts `location:` as an alias for `area:`. Collection accepts
`class:` as an alias for `type:`.

Common values include:

- `mode:softcore` or `mode:hardcore`
- `owned:true` or `owned:false`
- `eligible:true` or `eligible:false`
- `rarity:epic`, `rarity:legendary`, or `rarity:mi`
- slots such as `head`, `chest`, `amulet`, `medal`, `weapon`, and `offhand`

## Search and toolbar filters

Search combines with visible filters using `AND`. If MI Workshop is set to **Double rares
only**, a query does not bring magic or single-rare combinations back into the results. Sorting
changes order only; it never changes what matches.

Plain text searches the workspace's combined useful metadata. A fielded term narrows the same
query to one property. Prefer fielded queries when a word could mean several things—for example,
`source:zaria` instead of simply `zaria` when you care specifically about acquisition.

## Fixing a query

Cairn shows an inline explanation for incomplete syntax, unknown fields, and invalid numeric
comparisons. While a query is invalid, the current result surface remains visible instead of
flashing to an empty state.

| Message | Typical cause | Fix |
| --- | --- | --- |
| `Search terms cannot be empty.` | `skill:` | Add a value, such as `skill:wendigo`. |
| `Missing a closing quote.` | `name:"bloodsworn codex` | Add the final `"`. |
| `Missing a closing parenthesis.` | `(slot:amulet OR slot:medal` | Add `)`. |
| `Unknown search field …` | `skills:wendigo` | Use a field supported by that workspace, such as `skill:`. |
| `… needs a number` | `level:ancient` | Use a number or comparison, such as `level:>=75`. |

For contributors, the shared schemas, parser, builder, and workspace integration contract are documented in
[Workspace UI contract](architecture/workspace-ui.md).
