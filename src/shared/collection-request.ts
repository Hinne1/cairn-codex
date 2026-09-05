import type { CollectionBasis } from './contracts.ts'

export interface CollectionRequestContext {
  basis: CollectionBasis
  sourcePaths: string[]
}

/** Windows source identity; selections are sets and SC/HC paths remain distinct. */
export function collectionRequestKey(context: CollectionRequestContext): string {
  return JSON.stringify({
    basis: context.basis,
    sourcePaths: [...new Set(context.sourcePaths.map(path => path.replaceAll('\\', '/').toLowerCase()))].sort()
  })
}

export function copyCollectionRequest(context: CollectionRequestContext): CollectionRequestContext {
  return { basis: context.basis, sourcePaths: [...context.sourcePaths] }
}
