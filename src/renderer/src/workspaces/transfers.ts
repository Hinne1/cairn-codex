import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { compileSearchQuery, type CompiledSearchQuery } from '../../../shared/search-query.ts'
import { searchQueryOptions, searchSchemas } from '../../../shared/search-schema.ts'
import type { OperationHistoryOutcome } from '../../../shared/contracts.ts'
import type {
  TransferMode,
  TransferSection,
  VaultRarityFilter,
  VaultSortMode,
  SortDirection
} from '../app-route'

export interface TransfersSession {
  mode: Ref<TransferMode>
  section: Ref<TransferSection>
  historyQuery: Ref<string>
  historyOutcome: Ref<OperationHistoryOutcome>
  historyPage: Ref<number>
  vaultQuery: Ref<string>
  vaultRarity: Ref<VaultRarityFilter>
  vaultSort: Ref<VaultSortMode>
  vaultDirection: Ref<SortDirection>
  vaultPage: Ref<number>
  quarantinePage: Ref<number>
  selectedVaultIds: Ref<string[]>
  historyStructuredQuery: ComputedRef<CompiledSearchQuery>
  vaultStructuredQuery: ComputedRef<CompiledSearchQuery>
}

export function createTransfersSession(): TransfersSession {
  const historyQuery = ref('')
  const vaultQuery = ref('')
  return {
    mode: ref('live'),
    section: ref('ingest-history'),
    historyQuery,
    historyOutcome: ref('all'),
    historyPage: ref(1),
    vaultQuery,
    vaultRarity: ref('all'),
    vaultSort: ref('recent'),
    vaultDirection: ref('desc'),
    vaultPage: ref(1),
    quarantinePage: ref(1),
    selectedVaultIds: ref([]),
    historyStructuredQuery: computed(() => compileSearchQuery(
      historyQuery.value,
      searchQueryOptions(searchSchemas.history)
    )),
    vaultStructuredQuery: computed(() => compileSearchQuery(
      vaultQuery.value,
      searchQueryOptions(searchSchemas.vault)
    ))
  }
}

export function formatTransferTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export function formatOperationSource(source: 'item-assistant' | 'live' | 'offline'): string {
  if (source === 'item-assistant') return 'Item Assistant import'
  if (source === 'live') return 'Live game'
  return 'Offline shared stash'
}

export function transferSearchError(query: CompiledSearchQuery): string | null {
  if (!query.error) return null
  return query.error.fragment
    ? `${query.error.message} Check “${query.error.fragment}”.`
    : query.error.message
}
