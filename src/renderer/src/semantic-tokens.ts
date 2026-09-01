export type SemanticTone =
  | 'epic'
  | 'legendary'
  | 'level'
  | 'complete'
  | 'progress'
  | 'owned'
  | 'discovered'
  | 'crafting'
  | 'awakening'
  | 'fx'
  | 'missing'

export const THEME_MANIFEST_VERSION = 1 as const
export const DEFAULT_THEME_ID = 'cairn' as const

export const THEME_COLOR_TOKENS = [
  '--cc-canvas',
  '--cc-canvas-deep',
  '--cc-mix-light',
  '--cc-surface-1',
  '--cc-surface-2',
  '--cc-surface-3',
  '--cc-surface-raised',
  '--cc-surface-input',
  '--cc-border-subtle',
  '--cc-border-default',
  '--cc-border-strong',
  '--cc-border-emphasis',
  '--cc-focus',
  '--cc-text-strong',
  '--cc-text-primary',
  '--cc-text-secondary',
  '--cc-text-muted',
  '--cc-text-subtle',
  '--cc-text-disabled',
  '--cc-text-inverse',
  '--cc-accent',
  '--cc-accent-strong',
  '--cc-accent-soft',
  '--cc-accent-surface',
  '--cc-accent-surface-hover',
  '--cc-accent-border',
  '--cc-success',
  '--cc-success-border',
  '--cc-success-surface',
  '--cc-warning',
  '--cc-warning-border',
  '--cc-warning-surface',
  '--cc-danger',
  '--cc-danger-border',
  '--cc-danger-surface',
  '--cc-info',
  '--cc-info-border',
  '--cc-info-surface',
  '--cc-tone-green-accent',
  '--cc-tone-green-accent-soft',
  '--cc-tone-green-border',
  '--cc-tone-green-surface',
  '--cc-tone-green-muted',
  '--cc-tone-green-heading',
  '--cc-tone-green-focus',
  '--cc-tone-blue-accent',
  '--cc-tone-blue-border',
  '--cc-tone-blue-surface',
  '--cc-tone-blue-muted',
  '--cc-tone-blue-heading',
  '--cc-tone-ember-accent',
  '--cc-tone-ember-border',
  '--cc-tone-ember-surface'
] as const

export const PROTECTED_GAMEPLAY_TOKENS = [
  '--gd-rarity-epic',
  '--gd-rarity-legendary',
  '--semantic-level',
  '--semantic-complete',
  '--semantic-progress',
  '--semantic-owned',
  '--semantic-discovered',
  '--semantic-crafting',
  '--semantic-awakening',
  '--semantic-fx',
  '--semantic-missing'
] as const

export type ThemeColorToken = typeof THEME_COLOR_TOKENS[number]
export type ProtectedGameplayToken = typeof PROTECTED_GAMEPLAY_TOKENS[number]
export type ThemeTokenValues = { [Token in ThemeColorToken]: string }
export type ProtectedGameplayTokenValues = { [Token in ProtectedGameplayToken]: string }
export type ThemeTokenOverrides = Partial<ThemeTokenValues>

export interface ThemeManifestV1 {
  version: typeof THEME_MANIFEST_VERSION
  id: string
  name: string
  colorScheme: 'dark'
  tokens: ThemeTokenOverrides
}

export interface ThemeResolutionIssue {
  code: 'invalid-manifest' | 'unsupported-version' | 'unknown-token' | 'invalid-color' | 'insufficient-contrast'
  message: string
  token?: string
}

export interface ResolvedTheme {
  id: string
  name: string
  version: typeof THEME_MANIFEST_VERSION
  colorScheme: 'dark'
  tokens: ThemeTokenValues
  fallback: 'none' | 'partial' | 'cairn'
  issues: ThemeResolutionIssue[]
}

export interface ThemeStyleTarget {
  dataset: DOMStringMap
  style: Pick<CSSStyleDeclaration, 'setProperty'>
}

// These values intentionally mirror semantic-tokens.css. CSS is the no-JavaScript and root
// recovery fallback; test:theme-contract prevents the runtime manifest from drifting from it.
export const CAIRN_THEME_TOKENS: ThemeTokenValues = {
  '--cc-canvas': '#10100f',
  '--cc-canvas-deep': '#0d0d0c',
  '--cc-mix-light': '#ffffff',
  '--cc-surface-1': '#171714',
  '--cc-surface-2': '#1d1c18',
  '--cc-surface-3': '#24211b',
  '--cc-surface-raised': '#2a241b',
  '--cc-surface-input': '#11110f',
  '--cc-border-subtle': '#343026',
  '--cc-border-default': '#39352c',
  '--cc-border-strong': '#454034',
  '--cc-border-emphasis': '#554a37',
  '--cc-focus': '#8c7040',
  '--cc-text-strong': '#ece5d3',
  '--cc-text-primary': '#ded4bf',
  '--cc-text-secondary': '#b5ab98',
  '--cc-text-muted': '#8d8575',
  '--cc-text-subtle': '#756e61',
  '--cc-text-disabled': '#4e4a42',
  '--cc-text-inverse': '#19150e',
  '--cc-accent': '#d3aa55',
  '--cc-accent-strong': '#e7c477',
  '--cc-accent-soft': '#d5ba7b',
  '--cc-accent-surface': '#2a241b',
  '--cc-accent-surface-hover': '#30281a',
  '--cc-accent-border': '#55472f',
  '--cc-success': '#bdce91',
  '--cc-success-border': '#526039',
  '--cc-success-surface': '#1b2318',
  '--cc-warning': '#e0bd69',
  '--cc-warning-border': '#80632e',
  '--cc-warning-surface': '#251f16',
  '--cc-danger': '#dfa291',
  '--cc-danger-border': '#704238',
  '--cc-danger-surface': '#38221d',
  '--cc-info': '#9bc7d8',
  '--cc-info-border': '#3b4c54',
  '--cc-info-surface': '#151b1d',
  '--cc-tone-green-accent': '#91bd73',
  '--cc-tone-green-accent-soft': '#b8d277',
  '--cc-tone-green-border': '#46523e',
  '--cc-tone-green-surface': '#181a16',
  '--cc-tone-green-muted': '#75816d',
  '--cc-tone-green-heading': '#dcebd2',
  '--cc-tone-green-focus': '#73955f',
  '--cc-tone-blue-accent': '#6aa7c8',
  '--cc-tone-blue-border': '#3b4c54',
  '--cc-tone-blue-surface': '#151b1d',
  '--cc-tone-blue-muted': '#82949b',
  '--cc-tone-blue-heading': '#d7e6eb',
  '--cc-tone-ember-accent': '#df9443',
  '--cc-tone-ember-border': '#55462c',
  '--cc-tone-ember-surface': '#292319'
}

export const CAIRN_GAMEPLAY_TOKENS: ProtectedGameplayTokenValues = {
  '--gd-rarity-epic': '#79c2ff',
  '--gd-rarity-legendary': '#e099fa',
  '--semantic-level': '#d0b574',
  '--semantic-complete': '#dfbd6a',
  '--semantic-progress': '#b6c184',
  '--semantic-owned': '#b8ce78',
  '--semantic-discovered': '#adbbc3',
  '--semantic-crafting': '#82c9d1',
  '--semantic-awakening': '#e0b95d',
  '--semantic-fx': '#76c8c0',
  '--semantic-missing': '#c3bcb0'
}

export const CAIRN_THEME_MANIFEST: ThemeManifestV1 = {
  version: THEME_MANIFEST_VERSION,
  id: DEFAULT_THEME_ID,
  name: 'Cairn Codex',
  colorScheme: 'dark',
  tokens: {}
}

const themeTokenSet = new Set<string>(THEME_COLOR_TOKENS)
const protectedTokenSet = new Set<string>(PROTECTED_GAMEPLAY_TOKENS)
const opaqueHexColor = /^#[0-9a-f]{6}$/iu
const themeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const contrastRequirements: ReadonlyArray<{
  foreground: ThemeColorToken
  background: ThemeColorToken
  minimum: number
}> = [
  { foreground: '--cc-text-strong', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-text-primary', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-text-secondary', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-text-muted', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-text-subtle', background: '--cc-canvas', minimum: 3 },
  { foreground: '--cc-text-strong', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-text-primary', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-text-secondary', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-text-muted', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-text-subtle', background: '--cc-surface-1', minimum: 3 },
  { foreground: '--cc-text-primary', background: '--cc-surface-2', minimum: 4.5 },
  { foreground: '--cc-text-primary', background: '--cc-surface-3', minimum: 4.5 },
  { foreground: '--cc-text-primary', background: '--cc-surface-input', minimum: 4.5 },
  { foreground: '--cc-accent', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-accent', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-accent-strong', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-accent-strong', background: '--cc-accent-surface', minimum: 4.5 },
  { foreground: '--cc-accent-strong', background: '--cc-accent-surface-hover', minimum: 4.5 },
  { foreground: '--cc-accent-soft', background: '--cc-canvas', minimum: 4.5 },
  { foreground: '--cc-accent-soft', background: '--cc-surface-1', minimum: 4.5 },
  { foreground: '--cc-accent-soft', background: '--cc-accent-surface', minimum: 4.5 },
  { foreground: '--cc-accent-soft', background: '--cc-accent-surface-hover', minimum: 4.5 },
  { foreground: '--cc-text-inverse', background: '--cc-accent', minimum: 4.5 },
  { foreground: '--cc-focus', background: '--cc-canvas', minimum: 3 },
  { foreground: '--cc-focus', background: '--cc-surface-1', minimum: 3 },
  { foreground: '--cc-focus', background: '--cc-surface-input', minimum: 3 },
  { foreground: '--cc-success', background: '--cc-success-surface', minimum: 4.5 },
  { foreground: '--cc-warning', background: '--cc-warning-surface', minimum: 4.5 },
  { foreground: '--cc-danger', background: '--cc-danger-surface', minimum: 4.5 },
  { foreground: '--cc-info', background: '--cc-info-surface', minimum: 4.5 },
  { foreground: '--cc-tone-green-heading', background: '--cc-tone-green-surface', minimum: 4.5 },
  { foreground: '--cc-tone-green-accent', background: '--cc-tone-green-surface', minimum: 4.5 },
  { foreground: '--cc-tone-green-accent-soft', background: '--cc-tone-green-surface', minimum: 4.5 },
  { foreground: '--cc-tone-green-muted', background: '--cc-tone-green-surface', minimum: 3 },
  { foreground: '--cc-tone-green-focus', background: '--cc-tone-green-surface', minimum: 3 },
  { foreground: '--cc-tone-blue-heading', background: '--cc-tone-blue-surface', minimum: 4.5 },
  { foreground: '--cc-tone-blue-accent', background: '--cc-tone-blue-surface', minimum: 4.5 },
  { foreground: '--cc-tone-blue-muted', background: '--cc-tone-blue-surface', minimum: 3 },
  { foreground: '--cc-tone-ember-accent', background: '--cc-tone-ember-surface', minimum: 4.5 }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return opaqueHexColor.test(normalized) ? normalized : null
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function cairnFallback(issues: ThemeResolutionIssue[]): ResolvedTheme {
  return {
    id: CAIRN_THEME_MANIFEST.id,
    name: CAIRN_THEME_MANIFEST.name,
    version: THEME_MANIFEST_VERSION,
    colorScheme: 'dark',
    tokens: { ...CAIRN_THEME_TOKENS },
    fallback: 'cairn',
    issues
  }
}

export function resolveThemeManifest(input: unknown): ResolvedTheme {
  const issues: ThemeResolutionIssue[] = []
  if (!isRecord(input)) {
    return cairnFallback([{ code: 'invalid-manifest', message: 'Theme manifest must be an object.' }])
  }
  if (input.version !== THEME_MANIFEST_VERSION) {
    return cairnFallback([{
      code: 'unsupported-version',
      message: `Theme manifest version ${String(input.version)} is not supported.`
    }])
  }
  if (typeof input.id !== 'string' || !themeId.test(input.id) || input.id.length > 64 ||
      typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 80 ||
      input.colorScheme !== 'dark' || !isRecord(input.tokens)) {
    return cairnFallback([{ code: 'invalid-manifest', message: 'Theme manifest metadata or tokens are invalid.' }])
  }

  const tokens: ThemeTokenValues = { ...CAIRN_THEME_TOKENS }
  for (const [token, rawValue] of Object.entries(input.tokens)) {
    if (!themeTokenSet.has(token)) {
      issues.push({
        code: 'unknown-token',
        token,
        message: protectedTokenSet.has(token)
          ? `${token} is a protected gameplay semantic and cannot be overridden by a theme.`
          : `${token} is not part of theme manifest version ${THEME_MANIFEST_VERSION}.`
      })
      continue
    }
    const value = normalizedHexColor(rawValue)
    if (!value) {
      issues.push({
        code: 'invalid-color',
        token,
        message: `${token} must be an opaque six-digit hexadecimal color.`
      })
      continue
    }
    tokens[token as ThemeColorToken] = value
  }

  const contrastIssues = contrastRequirements.flatMap(({ foreground, background, minimum }) => {
    const ratio = contrastRatio(tokens[foreground], tokens[background])
    return ratio + Number.EPSILON < minimum
      ? [{
          code: 'insufficient-contrast' as const,
          token: foreground,
          message: `${foreground} must have at least ${minimum}:1 contrast against ${background}; received ${ratio.toFixed(2)}:1.`
        }]
      : []
  })
  const gameplayContrastIssues = PROTECTED_GAMEPLAY_TOKENS.flatMap((token) => {
    const ratio = contrastRatio(CAIRN_GAMEPLAY_TOKENS[token], tokens['--cc-surface-1'])
    return ratio + Number.EPSILON < 4.5
      ? [{
          code: 'insufficient-contrast' as const,
          token,
          message: `${token} must retain at least 4.5:1 contrast against --cc-surface-1; received ${ratio.toFixed(2)}:1.`
        }]
      : []
  })
  if (contrastIssues.length > 0 || gameplayContrastIssues.length > 0) {
    return cairnFallback([...issues, ...contrastIssues, ...gameplayContrastIssues])
  }

  return {
    id: input.id,
    name: input.name.trim(),
    version: THEME_MANIFEST_VERSION,
    colorScheme: 'dark',
    tokens,
    fallback: issues.length > 0 ? 'partial' : 'none',
    issues
  }
}

export function applyThemeManifest(target: ThemeStyleTarget, input: unknown): ResolvedTheme {
  const resolved = resolveThemeManifest(input)
  for (const token of THEME_COLOR_TOKENS) target.style.setProperty(token, resolved.tokens[token])
  target.dataset.theme = resolved.id
  target.dataset.themeVersion = String(resolved.version)
  target.dataset.themeFallback = resolved.fallback
  return resolved
}
