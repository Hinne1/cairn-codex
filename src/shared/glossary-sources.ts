export const glossarySources = [
  { label: 'Grim Dawn combat guide — Elemental damage and pets', url: 'https://www.grimdawn.com/guide/gameplay/combat/' },
  { label: 'Cairn Codex helper protocol — rating calculations', url: 'https://github.com/Hinne1/cairn-codex/blob/main/docs/architecture/helper-protocol.md' },
  { label: 'Cairn Codex collection schema — stored roll analysis', url: 'https://github.com/Hinne1/cairn-codex/blob/main/docs/architecture/collection-schema.md' }
] as const

export function isGlossarySourceUrl(url: string): boolean {
  return glossarySources.some(source => source.url === url)
}
