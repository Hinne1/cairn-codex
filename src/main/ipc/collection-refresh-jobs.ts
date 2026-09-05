import { BackgroundJobCoordinator, type BackgroundJobContext } from '../background-jobs.ts'
import type { CollectionSnapshot } from '../../shared/contracts.ts'

type RefreshKind = 'collection-scan' | 'game-data-rebuild'

/** Share only the committed catalog. Each caller owns its subsequent projection. */
export async function runCollectionRefresh(
  jobs: BackgroundJobCoordinator,
  kind: RefreshKind,
  operation: (job: BackgroundJobContext<RefreshKind>) => Promise<CollectionSnapshot>,
  projectForCaller: (snapshot: CollectionSnapshot) => Promise<CollectionSnapshot>
): Promise<CollectionSnapshot> {
  const rebuild = kind === 'game-data-rebuild'
  const shared = jobs.run({
    kind, dedupeKey: `${kind}:catalog`, stage: 'queued',
    progress: {
      completed: 0, total: 4, percent: 0, unit: 'steps',
      label: rebuild ? 'Rebuild game-data index' : 'Refresh collection',
      detail: rebuild ? 'Preparing a complete catalog rebuild.' : 'Preparing the catalog scan.'
    },
    canCancel: false, boundary: null,
    completedStage: 'complete', failedStage: 'failed', canceledStage: 'canceled'
  }, operation, result => ({
    summary: rebuild ? 'Game-data rebuild complete.' : 'Collection scan complete.',
    metrics: { catalogItems: result.items.length, observedItems: result.observedItems.length }
  }))
  return projectForCaller(await shared.result)
}
