import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  applyThemeManifest,
  CAIRN_GAMEPLAY_TOKENS,
  CAIRN_THEME_MANIFEST,
  CAIRN_THEME_TOKENS,
  contrastRatio,
  PROTECTED_GAMEPLAY_TOKENS,
  resolveThemeManifest,
  THEME_COLOR_TOKENS,
  THEME_MANIFEST_VERSION
} from '../src/renderer/src/semantic-tokens.ts'

const root = resolve('.')
const rendererRoot = resolve(root, 'src/renderer/src')
const themePath = resolve(rendererRoot, 'semantic-tokens.css')
const legacyStylesPath = resolve(rendererRoot, 'styles.css')
const colorLiteral = /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/giu

const requiredTokens = [
  '--cc-font-interface',
  '--cc-font-display',
  '--cc-control-height',
  '--cc-radius-sm',
  '--cc-canvas',
  '--cc-surface-1',
  '--cc-surface-input',
  '--cc-border-default',
  '--cc-focus',
  '--cc-text-primary',
  '--cc-text-muted',
  '--cc-accent',
  '--cc-success',
  '--cc-warning',
  '--cc-danger',
  '--gd-rarity-epic',
  '--gd-rarity-legendary'
]

const theme = await readFile(themePath, 'utf8')
for (const token of requiredTokens) {
  if (!theme.includes(`${token}:`)) throw new Error(`Required theme token is missing: ${token}`)
}

const cssHexTokens = new Map(
  [...theme.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/gimu)]
    .map((match) => [match[1], match[2].toLowerCase()])
)
for (const token of THEME_COLOR_TOKENS) {
  assert.equal(cssHexTokens.get(token), CAIRN_THEME_TOKENS[token], `${token} must match the CSS fallback`)
}
for (const token of PROTECTED_GAMEPLAY_TOKENS) {
  assert.equal(cssHexTokens.get(token), CAIRN_GAMEPLAY_TOKENS[token], `${token} must match the protected CSS value`)
}

async function filesBelow(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path, extension) : extname(entry.name) === extension ? [path] : []
  }))
  return nested.flat()
}

const componentFiles = await filesBelow(rendererRoot, '.vue')

for (const file of componentFiles) {
  const source = await readFile(file, 'utf8')
  const literals = source.match(colorLiteral) ?? []
  if (literals.length > 0) {
    throw new Error(
      `${file.slice(root.length + 1)} contains ${literals.length} literal color value(s). ` +
      'Shared components must consume semantic tokens from semantic-tokens.css.'
    )
  }
}

const defaultTheme = resolveThemeManifest(CAIRN_THEME_MANIFEST)
assert.equal(defaultTheme.fallback, 'none')
assert.equal(defaultTheme.id, 'cairn')

const alternateTheme = resolveThemeManifest({
  version: THEME_MANIFEST_VERSION,
  id: 'frost-test',
  name: 'Frost test',
  colorScheme: 'dark',
  tokens: {
    '--cc-accent': '#79c2ff',
    '--cc-accent-strong': '#9bd1ff',
    '--cc-accent-soft': '#8bc9ff'
  }
})
assert.equal(alternateTheme.fallback, 'none')
assert.equal(alternateTheme.tokens['--cc-accent'], '#79c2ff')
assert.equal(alternateTheme.tokens['--cc-canvas'], CAIRN_THEME_TOKENS['--cc-canvas'])

const partialTheme = resolveThemeManifest({
  version: THEME_MANIFEST_VERSION,
  id: 'partial-test',
  name: 'Partial test',
  colorScheme: 'dark',
  tokens: {
    '--cc-accent': 'gold',
    '--gd-rarity-epic': '#ffffff',
    '--future-token': '#ffffff'
  }
})
assert.equal(partialTheme.fallback, 'partial')
assert.equal(partialTheme.tokens['--cc-accent'], CAIRN_THEME_TOKENS['--cc-accent'])
assert.deepEqual(partialTheme.issues.map((issue) => issue.code), [
  'invalid-color', 'unknown-token', 'unknown-token'
])

const unsupportedTheme = resolveThemeManifest({
  version: THEME_MANIFEST_VERSION + 1,
  id: 'future-test',
  name: 'Future test',
  colorScheme: 'dark',
  tokens: {}
})
assert.equal(unsupportedTheme.fallback, 'cairn')
assert.equal(unsupportedTheme.id, 'cairn')

const inaccessibleTheme = resolveThemeManifest({
  version: THEME_MANIFEST_VERSION,
  id: 'low-contrast-test',
  name: 'Low contrast test',
  colorScheme: 'dark',
  tokens: { '--cc-text-primary': '#10100f' }
})
assert.equal(inaccessibleTheme.fallback, 'cairn')
assert.ok(inaccessibleTheme.issues.some((issue) => issue.code === 'insufficient-contrast'))

const gameplayCollisionTheme = resolveThemeManifest({
  version: THEME_MANIFEST_VERSION,
  id: 'gameplay-collision-test',
  name: 'Gameplay collision test',
  colorScheme: 'dark',
  tokens: { '--cc-surface-1': CAIRN_GAMEPLAY_TOKENS['--gd-rarity-epic'] }
})
assert.equal(gameplayCollisionTheme.fallback, 'cairn')
assert.ok(gameplayCollisionTheme.issues.some((issue) => issue.token === '--gd-rarity-epic'))

for (const [token, background] of [
  ['--cc-accent-strong', '--cc-accent-surface'],
  ['--cc-accent-strong', '--cc-accent-surface-hover'],
  ['--cc-accent-soft', '--cc-accent-surface'],
  ['--cc-accent-soft', '--cc-accent-surface-hover'],
  ['--cc-tone-green-accent-soft', '--cc-tone-green-surface'],
  ['--cc-tone-green-focus', '--cc-tone-green-surface']
]) {
  const hiddenRoleTheme = resolveThemeManifest({
    version: THEME_MANIFEST_VERSION,
    id: `${token.slice(5)}-contrast-test`,
    name: `${token} contrast test`,
    colorScheme: 'dark',
    tokens: { [background]: CAIRN_THEME_TOKENS[token] }
  })
  assert.equal(hiddenRoleTheme.fallback, 'cairn', `${token} cannot disappear against ${background}`)
  assert.ok(hiddenRoleTheme.issues.some((issue) => issue.token === token))
}

const appliedProperties = new Map()
const target = {
  dataset: {},
  style: { setProperty: (token, value) => appliedProperties.set(token, value) }
}
const appliedTheme = applyThemeManifest(target, {
  ...CAIRN_THEME_MANIFEST,
  id: 'applied-test',
  name: 'Applied test',
  tokens: { '--cc-accent': '#79c2ff' }
})
assert.equal(target.dataset.theme, 'applied-test')
assert.equal(target.dataset.themeVersion, String(THEME_MANIFEST_VERSION))
assert.equal(target.dataset.themeFallback, 'none')
assert.equal(appliedProperties.size, THEME_COLOR_TOKENS.length)
assert.equal(appliedProperties.get('--cc-accent'), '#79c2ff')
assert.equal(appliedTheme.id, 'applied-test')

const gameplayColors = PROTECTED_GAMEPLAY_TOKENS.map((token) => cssHexTokens.get(token))
assert.ok(gameplayColors.every(Boolean), 'Every protected gameplay token must have a CSS fallback color')
assert.equal(new Set(gameplayColors).size, gameplayColors.length, 'Gameplay semantic colors must remain distinct')
for (const [index, color] of gameplayColors.entries()) {
  assert.ok(
    contrastRatio(color, CAIRN_THEME_TOKENS['--cc-surface-1']) >= 4.5,
    `${PROTECTED_GAMEPLAY_TOKENS[index]} must retain 4.5:1 contrast against the shared card surface`
  )
}

// styles.css is the remaining legacy migration surface. This ceiling is a ratchet:
// foundation work may reduce it, while new literal workspace colors fail the build.
const legacyStyles = await readFile(legacyStylesPath, 'utf8')
const legacyLiteralCount = (legacyStyles.match(colorLiteral) ?? []).length
const legacyLiteralCeiling = 1214
if (legacyLiteralCount > legacyLiteralCeiling) {
  throw new Error(
    `styles.css contains ${legacyLiteralCount} literal colors; the migration ceiling is ${legacyLiteralCeiling}. ` +
    'Use semantic tokens instead of adding a workspace-local palette.'
  )
}

console.log(
  `Theme contract passed: manifest v${THEME_MANIFEST_VERSION}, ${THEME_COLOR_TOKENS.length} overridable colors, ` +
  `${PROTECTED_GAMEPLAY_TOKENS.length} protected gameplay colors, ${componentFiles.length} literal-free Vue components, ` +
  `${legacyLiteralCount}/${legacyLiteralCeiling} legacy literals.`
)
