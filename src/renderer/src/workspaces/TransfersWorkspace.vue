<script setup lang="ts">
import type {
  LiveGameStatus,
  OperationHistoryPage,
  StagingTabInspection,
  VaultItemPage,
  WriteSafetyStatus
} from '@shared/contracts'
import BoundedResultSurface from '../components/BoundedResultSurface.vue'
import ExplorerToolbar from '../components/ExplorerToolbar.vue'
import ToolHeader from '../components/ToolHeader.vue'
import { searchGuidance } from '../search-guidance'
import {
  formatOperationSource,
  formatTransferTimestamp,
  transferSearchError,
  type TransfersSession
} from './transfers'

interface TransferStashChoice {
  path: string
  isHardcore: boolean
}

const props = defineProps<{
  session: TransfersSession
  vaultBusy: boolean
  operationHistory: OperationHistoryPage
  operationHistoryLoading: boolean
  quarantineVaultPage: VaultItemPage
  vaultPageLoading: boolean
  liveStatus: LiveGameStatus | null
  gameConnectionLabel: string
  liveLifecyclePolling: boolean
  writeSafety: WriteSafetyStatus | null
  stashChoices: readonly TransferStashChoice[]
  staging: StagingTabInspection | null
}>()

const selectedStashPath = defineModel<string>('selectedStashPath', { required: true })
const emit = defineEmits<{
  'refresh-vault': []
  'start-live-mode': []
  'stop-live-mode': []
  'retrieve-selected-live': []
  'retrieve-selected': []
}>()

const {
  mode,
  section,
  historyQuery,
  historyOutcome,
  historyPage,
  vaultQuery,
  quarantinePage,
  selectedVaultIds,
  historyStructuredQuery,
  vaultStructuredQuery
} = props.session

const operationHistoryPageSize = 50
const vaultPageSize = 100

function selectVisibleQuarantine(): void {
  selectedVaultIds.value = props.quarantineVaultPage.items.map((item) => item.id)
}

function toggleVaultItem(id: string): void {
  selectedVaultIds.value = selectedVaultIds.value.includes(id)
    ? selectedVaultIds.value.filter((candidate) => candidate !== id)
    : [...selectedVaultIds.value, id]
}
</script>

<template>
  <section class="vault-workspace" aria-label="Item vault">
    <ToolHeader
      eyebrow="Transfers"
      title="Audit item movement and recover exceptions."
      description="Ingest and dispense histories are read-only. Only quarantined copies can be selected and returned to Grim Dawn from this workspace."
    >
      <template #aside>
        <button type="button" :disabled="vaultBusy" @click="emit('refresh-vault')">{{ vaultBusy ? 'Working…' : 'Recheck' }}</button>
      </template>
    </ToolHeader>

    <nav class="transfer-section-tabs" aria-label="Transfer workspace">
      <button type="button" :class="{ active: section === 'ingest-history' }" @click="section = 'ingest-history'">
        <strong>Ingest history</strong><small>Read-only · items entering CC</small>
      </button>
      <button type="button" :class="{ active: section === 'dispense-history' }" @click="section = 'dispense-history'">
        <strong>Dispense history</strong><small>Read-only · items sent to Grim Dawn</small>
      </button>
      <button type="button" :class="{ active: section === 'quarantine' }" @click="section = 'quarantine'">
        <strong>Quarantined items</strong><small>{{ quarantineVaultPage.total.toLocaleString() }} available for recovery</small>
      </button>
    </nav>

    <template v-if="section === 'ingest-history' || section === 'dispense-history'">
      <p class="vault-notice">Read-only audit trail. Historical operations cannot be selected, repeated, or changed here.</p>
      <ExplorerToolbar
        v-model="historyQuery"
        v-bind="searchGuidance.history"
        class="vault-explorer-toolbar"
        :search-label="section === 'ingest-history' ? 'Search ingest history' : 'Search dispense history'"
        placeholder="Item, seed, outcome, correlation ID…"
        :result-count="operationHistory.total"
        result-label="operations"
        :loading="operationHistoryLoading"
        :search-error="transferSearchError(historyStructuredQuery)"
      >
        <template #filters>
          <label><span>Outcome</span><select v-model="historyOutcome" autocomplete="off">
            <option value="all">All outcomes</option><option value="committed">Completed</option>
            <option value="failed">Failed</option><option value="pending">Needs attention</option>
          </select></label>
        </template>
      </ExplorerToolbar>

      <BoundedResultSurface
        v-model:page="historyPage"
        class="operation-history"
        :items="operationHistory.items"
        :get-key="operation => operation.id"
        :label="section === 'ingest-history' ? 'Ingest history' : 'Dispense history'"
        :page-size="operationHistoryPageSize"
        :total-count="operationHistory.total"
        :loading="operationHistoryLoading"
        remote
        empty-title="No matching operations"
        empty-detail="No operations match these filters."
      >
        <template #item="{ item: operation }">
          <article class="operation-history-row">
            <div class="operation-state" :class="`state-${operation.state}`">
              <strong>{{ operation.state === 'committed' ? 'Completed' : operation.state === 'failed' ? 'Failed' : 'Needs attention' }}</strong>
              <small>{{ operation.isHardcore === null ? 'Mode unknown' : operation.isHardcore ? 'Hardcore' : 'Softcore' }}</small>
            </div>
            <div class="operation-summary">
              <h3>{{ operation.itemCount }} item{{ operation.itemCount === 1 ? '' : 's' }} · {{ formatOperationSource(operation.source) }}</h3>
              <p v-if="operation.items.length">
                <span v-for="item in operation.items" :key="`${operation.id}:${item.record}:${item.seed}`">{{ item.name }}<small v-if="item.seed !== null">seed {{ item.seed }}</small></span>
                <em v-if="operation.additionalItemCount">+{{ operation.additionalItemCount }} more</em>
              </p>
              <p v-else class="operation-empty">No retained item summary is available for this historical operation.</p>
              <p v-if="operation.error" class="operation-error">{{ operation.error }}</p>
            </div>
            <dl class="operation-meta">
              <div><dt>Started</dt><dd>{{ formatTransferTimestamp(operation.startedAtUtc) }}</dd></div>
              <div v-if="operation.completedAtUtc"><dt>Finished</dt><dd>{{ formatTransferTimestamp(operation.completedAtUtc) }}</dd></div>
              <div><dt>Correlation ID</dt><dd><code>{{ operation.id }}</code></dd></div>
            </dl>
          </article>
        </template>
      </BoundedResultSurface>
    </template>

    <template v-else>
      <nav class="transfer-mode-tabs" aria-label="Quarantine return method">
        <button type="button" :class="{ active: mode === 'live' }" @click="mode = 'live'">
          <span><strong>Live game</strong><small>Return to the verified in-game deposit tab</small></span>
          <em :class="`state-${liveStatus?.state ?? 'unavailable'}`">{{ gameConnectionLabel }}</em>
        </button>
        <button type="button" :class="{ active: mode === 'offline' }" @click="mode = 'offline'">
          <span><strong>Offline stash</strong><small>Return through an atomic shared-stash write</small></span>
          <em :class="{ ready: writeSafety?.permitted }">{{ writeSafety?.permitted ? 'Ready' : 'Locked' }}</em>
        </button>
      </nav>

      <section v-if="mode === 'live'" class="live-mode-card" :class="`state-${liveStatus?.state ?? 'unavailable'}`">
        <div class="live-mode-status"><span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" /><div>
          <p class="section-label">Quarantine destination</p>
          <h3>{{ liveStatus?.state === 'ready' ? liveStatus.depositTabDescription : 'Connect to Grim Dawn' }}</h3>
          <small>{{ liveStatus?.detail || 'Checking the verified live adapter…' }}</small>
        </div></div>
        <div class="live-mode-actions">
          <button v-if="liveStatus?.state !== 'ready'" type="button" :disabled="vaultBusy || liveLifecyclePolling || liveStatus?.state === 'unavailable' || liveStatus?.state === 'blocked'" @click="emit('start-live-mode')">{{ liveStatus?.state === 'connecting' ? 'Connecting…' : 'Connect' }}</button>
          <button v-else type="button" :disabled="vaultBusy || liveLifecyclePolling" @click="emit('stop-live-mode')">Disconnect</button>
        </div>
      </section>

      <div v-else class="vault-target">
        <label><span>Return to shared stash</span><select v-model="selectedStashPath" :disabled="vaultBusy">
          <option v-for="stash in stashChoices" :key="stash.path" :value="stash.path">{{ stash.isHardcore ? 'Hardcore' : 'Softcore' }} · {{ stash.path }}</option>
        </select></label>
        <div class="safety-state" :class="{ safe: writeSafety?.permitted }"><span class="status-dot" :class="{ dim: !writeSafety?.permitted }" /><div>
          <strong>{{ writeSafety?.permitted ? 'Writes unlocked' : 'Writes locked' }}</strong>
          <small v-if="writeSafety?.permitted">Grim Dawn and Item Assistant are closed.</small>
          <small v-else>{{ writeSafety?.reasons.join(' ') || 'Checking running processes…' }}</small>
        </div></div>
      </div>

      <ExplorerToolbar
        v-model="vaultQuery"
        v-bind="searchGuidance.vault"
        class="vault-explorer-toolbar"
        search-label="Search quarantine"
        placeholder="Item record, name, seed…"
        :result-count="quarantineVaultPage.total"
        result-label="quarantined copies"
        :loading="vaultPageLoading"
        :search-error="transferSearchError(vaultStructuredQuery)"
      >
        <template #actions>
          <button type="button" :disabled="quarantineVaultPage.items.length === 0" @click="selectVisibleQuarantine">Select visible</button>
          <button type="button" :disabled="selectedVaultIds.length === 0" @click="selectedVaultIds = []">Clear</button>
        </template>
      </ExplorerToolbar>
      <section class="vault-quarantine quarantine-workspace">
        <header><div><p class="section-label">Recovery quarantine</p><h3>{{ quarantineVaultPage.total }} non-catalog item{{ quarantineVaultPage.total === 1 ? '' : 's' }} safely stored</h3></div></header>
        <p>CC retained these items because they could not safely join the collection catalog. Review the exact record and return only the copies you recognize.</p>
        <BoundedResultSurface
          v-model:page="quarantinePage"
          v-model:selected-keys="selectedVaultIds"
          class="quarantine-results"
          :items="quarantineVaultPage.items"
          :get-key="item => item.id"
          :page-size="vaultPageSize"
          :total-count="quarantineVaultPage.total"
          :loading="vaultPageLoading"
          :selection-disabled="vaultBusy"
          label="Quarantined items"
          selection-mode="multiple"
          remote
          empty-title="Nothing is waiting in quarantine"
          empty-detail="Items that cannot safely join the catalog will appear here for review."
        >
          <template #item="{ item, selected }">
            <div class="vault-row unsupported">
              <input type="checkbox" :checked="selected" :disabled="vaultBusy" :aria-label="`Select ${item.name}`" @click.stop @change="toggleVaultItem(item.id)" />
              <div><strong>{{ item.name }}</strong><small>{{ item.isHardcore ? 'HC' : 'SC' }} · {{ item.baseRecord }} · seed {{ item.seed }}</small></div>
            </div>
          </template>
        </BoundedResultSurface>
        <div class="quarantine-actions">
          <button v-if="mode === 'live'" type="button" :disabled="vaultBusy || liveStatus?.state !== 'ready' || selectedVaultIds.length === 0" @click="emit('retrieve-selected-live')">{{ vaultBusy ? 'Waiting for game…' : `Return ${selectedVaultIds.length || ''} selected live` }}</button>
          <button v-else type="button" :disabled="vaultBusy || !writeSafety?.permitted || staging?.itemCount !== 0 || selectedVaultIds.length === 0" @click="emit('retrieve-selected')">{{ vaultBusy ? 'Verifying…' : `Return ${selectedVaultIds.length || ''} selected offline` }}</button>
        </div>
        <small v-if="mode === 'live'">Live return commits each copy only after the game acknowledges receipt.</small>
        <small v-else>Offline return requires Grim Dawn and Item Assistant to be closed and the final shared stash tab to be empty.</small>
      </section>
    </template>
  </section>
</template>
