# Theme extension contract

Cairn Codex theme manifests customize the shared application palette without creating a
workspace-specific stylesheet. Version 1 is deliberately narrow: it supports dark themes,
opaque six-digit hexadecimal colors, and the color roles exported by
`src/renderer/src/semantic-tokens.ts`. Typography, spacing, control geometry, motion, and
responsive behavior are not theme extension points.

## Manifest version 1

```json
{
  "version": 1,
  "id": "frostbound",
  "name": "Frostbound",
  "colorScheme": "dark",
  "tokens": {
    "--cc-canvas": "#0d1218",
    "--cc-surface-1": "#141c24",
    "--cc-text-primary": "#dce8f2",
    "--cc-accent": "#79c2ff"
  }
}
```

- `version` must equal `THEME_MANIFEST_VERSION`. A newer or otherwise unsupported version is
  rejected as a unit so its meaning cannot be guessed by an older CC build.
- `id` is a lowercase, dash-separated stable identifier of at most 64 characters.
- `name` is a non-empty display name of at most 80 characters.
- `colorScheme` is `dark` in version 1.
- `tokens` is a partial map. The public allowlist is `THEME_COLOR_TOKENS`; missing values inherit
  the Cairn defaults. Values must be opaque `#rrggbb` colors.

The manifest describes semantic roles, not selectors. A theme can change the shared accent or
surface hierarchy, but it cannot target Collection, Sets, Settings, or another workspace by
name. New renderer code continues to consume `var(--cc-...)` roles and must not inspect the
active theme identifier to choose presentation.

## Resolution and fallback

`resolveThemeManifest` validates untrusted manifest data and returns a complete palette.
`applyThemeManifest` writes that resolved palette to a root style target and records the applied
identifier, version, and fallback state in `data-theme`, `data-theme-version`, and
`data-theme-fallback`.

| Input condition | Result |
| --- | --- |
| Valid version-1 metadata and colors | Apply the extension over Cairn defaults. |
| Missing token | Use that token's Cairn default. |
| Unknown, protected, or malformed token | Ignore that token, use its Cairn default, and report a partial fallback issue. |
| Unsupported version or invalid manifest metadata | Apply the complete Cairn theme. |
| Any required contrast pair fails after merging | Apply the complete Cairn theme; mixed unreadable palettes are never applied. |

The static declarations in `semantic-tokens.css` are the startup and root-recovery fallback.
`CAIRN_THEME_TOKENS` mirrors their overridable values for validation and application. The theme
contract test fails if those two representations drift.

## Accessibility and gameplay semantics

The resolver checks WCAG contrast for primary content, muted content, focus, inverse text,
feedback states, and workspace tone headings/accents. Normal text pairs require at least 4.5:1;
large/de-emphasized roles and focus indicators require at least 3:1.

Grim Dawn rarity and gameplay colors are data semantics, not application chrome. The
`--gd-rarity-*` and `--semantic-*` variables are intentionally excluded from the extension
allowlist. Version 1 therefore cannot make Epic look Legendary or make ownership, crafting,
awakening, and missing states theme-dependent. The automated contract requires every protected
color to remain unique and to retain at least 4.5:1 contrast against the shared card surface.

## Adding or evolving themes

1. Build a manifest against the exported version and token allowlist.
2. Resolve it before exposing or persisting its identifier. Display reported issues rather than
   silently claiming that an invalid extension is active.
3. Exercise the normal wide and 520-pixel visual matrix; themes may alter color only, never
   geometry or layout.
4. Add a new manifest version when token meaning, accepted value syntax, or fallback semantics
   change. Keep the older resolver while persisted manifests for that version remain supported.

`npm run test:theme-contract` enforces manifest/CSS synchronization, resolution and fallback
behavior, contrast and protected gameplay semantics, literal-free Vue components, and the
ratcheted legacy `styles.css` color ceiling.
