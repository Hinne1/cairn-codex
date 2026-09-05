import type { CollectionBasis, CollectionSnapshot } from '../shared/contracts.ts'

/** Presentation-only fixtures must not be re-read from their empty test archive.
 * Receives the already source-filtered snapshot; never imports or persists copies.
 * Unknown fixtures and ordinary startup use the production presenter instead.
 */
export function presentScreenshotCollection(
  snapshot: CollectionSnapshot,
  basis: CollectionBasis,
  screenshotPath: string | undefined,
  fixtureName: string | undefined,
  createFixture: (name: string) => CollectionSnapshot
): CollectionSnapshot | null {
  if (!screenshotPath) return null
  switch (fixtureName) {
    case 'skill-explorer':
      return { ...snapshot, basis, items: createFixture(fixtureName).items }
    case 'bounded-grid-a11y':
    case 'workspace-queries':
    case 'mi-workshop':
      return { ...snapshot, basis }
    default:
      return null
  }
}
