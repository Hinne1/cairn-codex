# Read-only blueprint ownership

Cairn reads account blueprint ownership from the `formulas.*` files beside the
discovered transfer stashes. Softcore (`*.gst`, `*.bst`, `*.cst`, `*.dst`) and
Hardcore (`*.gsh`, `*.bsh`, `*.csh`, `*.dsh`) records remain separate.

Formula saves are plaintext Grim Dawn block data. Cairn does not rewrite or
fully deserialize those blocks: it extracts normalized `records/...dbr` tokens
from the file and joins them to `ItemArtifactFormula.artifactName` references in
the installed ARZ. Only a formula that points directly at a concrete item is
reported as a deterministic recipe. Recipes whose artifact is a broad random
loot table are deliberately excluded from item-specific crafting status.

Imported character planner profiles use the matching Hardcore or Softcore
formula index. Manual profiles show every account mode in which the recipe is
known. A missing or unreadable formula source never grants ownership.

The plaintext-token approach was independently checked against the BSD-licensed
[`GrimDawn.Formulas`](https://github.com/xaviershay/gd-explorer/blob/main/src/GrimDawn/Formulas.hs)
reader and against the locally installed account files.
