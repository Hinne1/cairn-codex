import type { AnyBackgroundJobSnapshot } from '../../shared/background-jobs.ts'

export interface BackgroundJobStore {
  list(): AnyBackgroundJobSnapshot[]
  requestCancellation(id: string): AnyBackgroundJobSnapshot | null
}

export class BackgroundJobService {
  private readonly store: BackgroundJobStore

  constructor(store: BackgroundJobStore) {
    this.store = store
  }

  list(): AnyBackgroundJobSnapshot[] {
    return this.store.list()
  }

  cancel(input: { id: string }): AnyBackgroundJobSnapshot | null {
    return this.store.requestCancellation(input.id)
  }
}
