import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('.')
const rendererRoot = resolve(root, 'src/renderer/src')
const themePath = resolve(rendererRoot, 'semantic-tokens.css')
const legacyStylesPath = resolve(rendererRoot, 'styles.css')
const componentRoot = resolve(rendererRoot, 'components')
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

const componentFiles = (await readdir(componentRoot))
  .filter((file) => file.endsWith('.vue'))
  .map((file) => resolve(componentRoot, file))

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
  `Theme contract passed: ${requiredTokens.length} required tokens, ` +
  `${componentFiles.length} literal-free shared components, ${legacyLiteralCount}/${legacyLiteralCeiling} legacy literals.`
)
