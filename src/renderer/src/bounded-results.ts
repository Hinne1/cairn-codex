export type BoundedResultKey = string | number

export interface BoundedResultEntry<T> {
  item: T
  key: BoundedResultKey
  index: number
}

export interface BoundedResultWindow<T> {
  entries: BoundedResultEntry<T>[]
  page: number
  pageCount: number
  pageSize: number
  totalCount: number
  firstIndex: number
  lastIndex: number
  hasPrevious: boolean
  hasNext: boolean
}

export interface BoundedResultOptions<T> {
  items: readonly T[]
  getKey: (item: T, index: number) => BoundedResultKey
  page?: number
  pageSize?: number
  totalCount?: number
  remote?: boolean
}

export type BoundedNavigationIntent =
  | 'first'
  | 'last'
  | 'previous'
  | 'next'
  | 'row-up'
  | 'row-down'

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value ?? fallback))
}

export function createBoundedResultWindow<T>(options: BoundedResultOptions<T>): BoundedResultWindow<T> {
  const pageSize = positiveInteger(options.pageSize, 50)
  const remote = options.remote === true
  const totalCount = remote
    ? Math.max(0, Math.trunc(options.totalCount ?? options.items.length))
    : options.items.length
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Math.min(positiveInteger(options.page, 1), pageCount)
  const firstIndex = totalCount === 0 ? 0 : (page - 1) * pageSize
  const source = remote
    ? options.items.slice(0, pageSize)
    : options.items.slice(firstIndex, firstIndex + pageSize)
  const seen = new Set<BoundedResultKey>()
  const entries = source.map((item, localIndex) => {
    const index = firstIndex + localIndex
    const key = options.getKey(item, index)
    if (seen.has(key)) throw new Error(`Bounded results require stable unique keys; duplicate key: ${String(key)}`)
    seen.add(key)
    return { item, key, index }
  })
  const lastIndex = entries.length === 0 ? 0 : firstIndex + entries.length

  return {
    entries,
    page,
    pageCount,
    pageSize,
    totalCount,
    firstIndex,
    lastIndex,
    hasPrevious: page > 1,
    hasNext: page < pageCount
  }
}

export function moveBoundedResultKey(
  keys: readonly BoundedResultKey[],
  current: BoundedResultKey | null,
  intent: BoundedNavigationIntent,
  columns = 1
): BoundedResultKey | null {
  if (keys.length === 0) return null
  const currentIndex = current === null ? -1 : keys.indexOf(current)
  const normalizedIndex = currentIndex < 0 ? 0 : currentIndex
  const rowSize = positiveInteger(columns, 1)
  let nextIndex = normalizedIndex

  if (intent === 'first') nextIndex = 0
  if (intent === 'last') nextIndex = keys.length - 1
  if (intent === 'previous') nextIndex = normalizedIndex - 1
  if (intent === 'next') nextIndex = normalizedIndex + 1
  if (intent === 'row-up') nextIndex = normalizedIndex - rowSize
  if (intent === 'row-down') nextIndex = normalizedIndex + rowSize

  return keys[Math.min(Math.max(nextIndex, 0), keys.length - 1)] ?? null
}
