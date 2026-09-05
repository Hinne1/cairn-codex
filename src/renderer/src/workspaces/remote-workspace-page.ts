import { onScopeDispose, ref, shallowRef, watch } from 'vue'

/** Owns one page request generation, including unmount and refresh invalidation. */
export function useRemoteWorkspacePage<Q, P>(options: {
  request: () => Q
  revision: () => number
  fetch: (request: Q) => Promise<P>
  empty: P
  formatError: (error: unknown) => string
  enabled?: () => boolean
  delayMs?: number
}) {
  const data = shallowRef<P>(options.empty)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const reload = (): void => {
    const current = ++generation
    clearTimeout(timer)
    error.value = null
    if (options.enabled?.() === false) { loading.value = false; return }
    const request = JSON.parse(JSON.stringify(options.request())) as Q
    loading.value = true
    timer = setTimeout(() => {
      void options.fetch(request).then(result => {
        if (generation === current) data.value = result
      }).catch(problem => {
        if (generation === current) error.value = options.formatError(problem)
      }).finally(() => {
        if (generation === current) loading.value = false
      })
    }, options.delayMs ?? 100)
  }
  watch([() => JSON.stringify(options.request()), options.revision, () => options.enabled?.()], reload,
    { immediate: true, flush: 'sync' })
  onScopeDispose(() => { generation++; clearTimeout(timer) })
  return { data, loading, error, reload }
}
