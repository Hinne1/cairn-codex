import type { CollectionSnapshot } from '../../shared/contracts.ts'
import { collectionRequestKey, copyCollectionRequest, type CollectionRequestContext } from '../../shared/collection-request.ts'

export type CollectionReadKind = 'cache' | 'scan' | 'rebuild' | 'hydration'
export type CollectionPendingReads = Record<CollectionReadKind, number>

export interface CollectionRead {
  readonly context: CollectionRequestContext
  isCurrent(): boolean
  install(snapshot: CollectionSnapshot | null): boolean
}

interface CollectionSessionOptions {
  context(): CollectionRequestContext
  install(snapshot: CollectionSnapshot): void
  reportError(error: unknown, kind: CollectionReadKind): void
  pendingChanged(pending: CollectionPendingReads): void
  reload(): void
}

/** One owner for renderer snapshot reads, including failures and committed updates. */
export class CollectionSession {
  private readonly options: CollectionSessionOptions
  private contextKey: string
  private installedContextKey: string | null = null
  private generation = 0
  private disposed = false
  private readonly pending: CollectionPendingReads = { cache: 0, scan: 0, rebuild: 0, hydration: 0 }

  constructor(options: CollectionSessionOptions) {
    this.options = options
    this.contextKey = collectionRequestKey(options.context())
  }

  // Call synchronously on selection changes: A -> B -> A must invalidate old A.
  contextChanged(): void {
    const key = collectionRequestKey(this.options.context())
    if (key !== this.contextKey) {
      this.contextKey = key
      this.generation++
    }
  }

  async run(kind: CollectionReadKind, operation: (read: CollectionRead) => Promise<void>): Promise<boolean> {
    if (this.disposed) return false
    this.contextChanged()
    let generation = ++this.generation
    const context = copyCollectionRequest(this.options.context())
    const isCurrent = (): boolean => {
      this.contextChanged()
      return !this.disposed && generation === this.generation
    }
    const read: CollectionRead = {
      context, isCurrent,
      install: snapshot => {
        if (!isCurrent()) {
          // The catalog refresh still committed useful shared work. Project it
          // again for the selection that now owns the view, using a new read.
          if (snapshot && !this.disposed && (kind === 'scan' || kind === 'rebuild' || kind === 'hydration')) this.options.reload()
          return false
        }
        if (snapshot) {
          this.options.install(snapshot)
          // Installing the first snapshot populates an empty selection with its
          // sources. This is part of this read, not a competing user selection.
          const selected = this.options.context()
          if (context.sourcePaths.length === 0 && collectionRequestKey(selected) === collectionRequestKey({
            basis: context.basis, sourcePaths: snapshot.scannedStashes?.map(stash => stash.path) ?? []
          })) {
            this.contextChanged()
            context.sourcePaths = [...selected.sourcePaths]
            generation = this.generation
          }
          this.installedContextKey = collectionRequestKey(context)
        }
        return isCurrent()
      }
    }
    this.pending[kind]++
    this.options.pendingChanged({ ...this.pending })
    try {
      await operation(read)
    } catch (error) {
      if (isCurrent()) this.options.reportError(error, kind)
    } finally {
      this.pending[kind]--
      this.options.pendingChanged({ ...this.pending })
    }
    return isCurrent()
  }

  /** A committed change invalidates every read captured before that change. */
  invalidate(): void {
    this.generation++
    this.installedContextKey = null
    if (!this.disposed) this.options.reload()
  }

  commit(snapshot: CollectionSnapshot): void {
    this.contextChanged()
    this.generation++
    if (this.disposed) return
    if (this.installedContextKey === this.contextKey) this.options.install(snapshot)
    // The visible snapshot may still belong to a previous SC/HC or basis
    // selection. Re-read after the commit instead of applying that old delta.
    else this.options.reload()
  }

  dispose(): void { this.disposed = true; this.generation++ }
}
