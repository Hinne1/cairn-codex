<script setup lang="ts">
import { computed } from 'vue'
import type {
  ArchiveBackupStatus,
  CollectionBasis,
  DebugLoggingStatus,
  GdiaImportResult,
  LiveGameStatus,
  RecoveryStatus
} from '@shared/contracts'
import ItemAssistantImport from '../components/ItemAssistantImport.vue'
import ToolHeader from '../components/ToolHeader.vue'
import type { OnboardingStatus } from '../onboarding'
import {
  formatSettingsBackupDate,
  formatSettingsBackupSize,
  settingsArchiveModeCount,
  settingsArchiveModeEnabled,
  settingsOnboardingStatusLabel,
  type MiCountingMode,
  type SettingsStashChoice,
  type WorkspaceToolDefinition,
  type WorkspaceToolId
} from './settings'

const props = defineProps<{
  onboardingStatus: OnboardingStatus
  onboardingStep: number
  autoLiveConnect: boolean
  safeModeActive: boolean
  liveStatus: LiveGameStatus | null
  gameConnectionLabel: string
  connectionRecommendation: string
  zoomFactor: number
  experimentalToolsEnabled: boolean
  workspaceToolDefinitions: readonly WorkspaceToolDefinition[]
  visibleWorkspaceToolIds: readonly WorkspaceToolId[]
  snapshotReady: boolean
  archiveBackupStatus: ArchiveBackupStatus | null
  archiveBackupBusy: 'backup' | 'export' | 'restore' | null
  showLegacyScanner: boolean
  stashChoices: readonly SettingsStashChoice[]
  indexStashPaths: readonly string[]
  archiveStashPaths: readonly string[]
  vaultBusy: boolean
  infiniteSupplies: boolean
  infiniteSuppliesBusy: boolean
  scanning: boolean
  scanActivity: 'collection' | 'game-data'
  sahdinaRecoveryBusy: 'shared-stash' | 'character-inventory' | null
  recoveryStatus: RecoveryStatus | null
  debugLoggingStatus: DebugLoggingStatus
  debugLoggingBusy: boolean
  diagnosticsBusy: boolean
  preferenceExportBusy: boolean
  safeModeBusy: boolean
}>()

const miCountingMode = defineModel<MiCountingMode>('miCountingMode', { required: true })
const selectedStashPath = defineModel<string>('selectedStashPath', { required: true })

const emit = defineEmits<{
  'resume-onboarding': [restart: boolean]
  'set-auto-live-connect': [enabled: boolean]
  'show-connection-diagnostics': []
  'set-zoom': [factor: number]
  'show-essential-tools': []
  'show-all-tools': []
  'set-experimental-tools': [enabled: boolean]
  'set-tool-visible': [id: WorkspaceToolId, visible: boolean]
  'gdia-import-completed': [result: GdiaImportResult]
  'archive-backup': [action: 'backup' | 'export' | 'restore' | 'open-folder']
  'set-legacy-scanner-visible': [enabled: boolean]
  'select-source-mode': [basis: CollectionBasis, isHardcore: boolean]
  'toggle-source': [basis: CollectionBasis, path: string]
  'set-archive-mode': [isHardcore: boolean, enabled: boolean]
  'set-infinite-supplies': [enabled: boolean]
  'rebuild-game-data-index': []
  'recover-sahdina': [destination: 'shared-stash' | 'character-inventory']
  'set-debug-logging': [enabled: boolean]
  'export-diagnostics': []
  'export-preferences': []
  'open-data-directory': []
  'reset-interface-preferences': []
  'restart-safe-mode': [enabled: boolean]
}>()

const onboardingStatusLabel = computed(() => settingsOnboardingStatusLabel(props.onboardingStatus, props.onboardingStep))
const archiveModeCount = computed(() => settingsArchiveModeCount(props.stashChoices, props.archiveStashPaths))
const selectedToolIds = computed(() => new Set(props.visibleWorkspaceToolIds))

function archiveModeEnabled(isHardcore: boolean): boolean {
  return settingsArchiveModeEnabled(props.stashChoices, props.archiveStashPaths, isHardcore)
}

function workspaceToolSelected(id: WorkspaceToolId): boolean {
  return selectedToolIds.value.has(id)
}
</script>

<template>
  <section class="settings-workspace" aria-label="Cairn Codex settings">
    <ToolHeader
      eyebrow="Settings"
      title="Collection and transfer behavior"
      description="Long-lived choices live here. Search, filters, and sorting remain workspace controls."
    />

    <div class="settings-grid">
      <article class="settings-card onboarding-settings-card">
        <p class="section-label">Getting started</p>
        <h3>First-run guide</h3>
        <p>Reopen the guided tour for discovery, Item Assistant migration, archive/live transfers, SC/HC identity, backups, and experimental tools.</p>
        <div class="settings-status">
          <span class="status-dot" :class="{ dim: onboardingStatus !== 'completed' }" />
          <span><strong>{{ onboardingStatusLabel }}</strong>The guide never hides recovery or support controls.</span>
        </div>
        <div class="archive-backup-actions">
          <button class="settings-action" type="button" @click="emit('resume-onboarding', false)">{{ onboardingStatus === 'in-progress' ? 'Resume guide' : 'Open guide' }}</button>
          <button class="settings-action" type="button" @click="emit('resume-onboarding', true)">Start from beginning</button>
        </div>
      </article>

      <article class="settings-card">
        <p class="section-label">Live game</p>
        <h3>Connection lifecycle</h3>
        <label class="settings-toggle">
          <input
            type="checkbox"
            :checked="autoLiveConnect"
            :disabled="safeModeActive"
            @change="emit('set-auto-live-connect', ($event.target as HTMLInputElement).checked)"
          />
          <span><strong>Auto-connect</strong><small>{{ safeModeActive ? 'Paused while recovery safe mode is active.' : 'Connect when Grim Dawn starts and disconnect when it exits.' }}</small></span>
        </label>
        <div class="settings-status">
          <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
          <span><strong>{{ gameConnectionLabel }}</strong>{{ liveStatus?.detail ?? 'Checking live adapter…' }}</span>
        </div>
        <small class="settings-recommendation"><strong>Recommended:</strong> {{ connectionRecommendation }}</small>
        <button class="settings-action" type="button" @click="emit('show-connection-diagnostics')">View connection diagnostics</button>
      </article>

      <article class="settings-card">
        <p class="section-label">Display</p>
        <h3>Interface scale</h3>
        <div class="zoom-controls">
          <button type="button" @click="emit('set-zoom', zoomFactor - 0.1)">−</button>
          <strong>{{ Math.round(zoomFactor * 100) }}%</strong>
          <button type="button" @click="emit('set-zoom', zoomFactor + 0.1)">+</button>
          <button type="button" @click="emit('set-zoom', 1)">Reset</button>
        </div>
        <small>Ctrl + mouse wheel works anywhere in CC.</small>
      </article>

      <article class="settings-card workspace-tool-settings">
        <header>
          <div><p class="section-label">Workspace</p><h3>Visible tools</h3></div>
          <div class="workspace-tool-presets">
            <button type="button" @click="emit('show-essential-tools')">Essentials</button>
            <button type="button" @click="emit('show-all-tools')">Show all</button>
          </div>
        </header>
        <p>Collection remains the permanent home view. Choose which specialist tools appear below the progress tracker.</p>
        <label class="settings-toggle experimental-tools-toggle">
          <input
            type="checkbox"
            :checked="experimentalToolsEnabled && !safeModeActive"
            :disabled="safeModeActive"
            @change="emit('set-experimental-tools', ($event.target as HTMLInputElement).checked)"
          />
          <span><strong>Enable experimental tools</strong><small>{{ safeModeActive ? 'Unavailable while recovery safe mode is active.' : 'Shows Stash Oracle and the read-only Dismantling Lab. Their recommendations and simulations are explicitly provisional.' }}</small></span>
        </label>
        <div class="workspace-tool-options">
          <label v-for="tool in workspaceToolDefinitions" :key="tool.id" class="settings-toggle compact">
            <input
              type="checkbox"
              :checked="tool.experimental && !experimentalToolsEnabled ? false : workspaceToolSelected(tool.id)"
              :disabled="tool.experimental && !experimentalToolsEnabled"
              @change="emit('set-tool-visible', tool.id, ($event.target as HTMLInputElement).checked)"
            />
            <span><strong>{{ tool.label }}{{ tool.experimental ? ' · Experimental' : '' }}</strong><small>{{ tool.detail }}</small></span>
          </label>
        </div>
      </article>

      <ItemAssistantImport :disabled="!snapshotReady" @completed="emit('gdia-import-completed', $event)" />

      <article class="settings-card archive-protection-settings">
        <p class="section-label">Archive protection</p>
        <h3>Verified rotating backups</h3>
        <p>CC keeps up to 12 verified snapshots after archive changes, plus three emergency pre-restore snapshots. Backups contain the Codex database only; Grim Dawn saves and stashes remain separate.</p>
        <div v-if="archiveBackupStatus?.latest" class="archive-backup-latest">
          <span class="status-dot" />
          <div>
            <strong>Last verified {{ formatSettingsBackupDate(archiveBackupStatus.latest.createdAtUtc) }}</strong>
            <small>
              {{ archiveBackupStatus.latest.vaultItemCount.toLocaleString() }} stored copies ·
              {{ formatSettingsBackupSize(archiveBackupStatus.latest.sizeBytes) }} ·
              {{ archiveBackupStatus.latest.reason }}
            </small>
          </div>
        </div>
        <div v-else class="archive-backup-latest empty">
          <span class="status-dot dim" />
          <div><strong>No verified backup yet</strong><small>CC will create one automatically, or you can start one now.</small></div>
        </div>
        <small v-if="archiveBackupStatus">
          {{ archiveBackupStatus.backups.length }} rotating backup{{ archiveBackupStatus.backups.length === 1 ? '' : 's' }} retained locally.
        </small>
        <div class="archive-backup-actions">
          <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="emit('archive-backup', 'backup')">
            {{ archiveBackupBusy === 'backup' ? 'Verifying backup…' : 'Back up now' }}
          </button>
          <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="emit('archive-backup', 'export')">
            {{ archiveBackupBusy === 'export' ? 'Exporting…' : 'Export backup…' }}
          </button>
          <button class="settings-action danger" type="button" :disabled="Boolean(archiveBackupBusy)" @click="emit('archive-backup', 'restore')">
            {{ archiveBackupBusy === 'restore' ? 'Verifying restore…' : 'Restore backup…' }}
          </button>
          <button class="settings-action" type="button" :disabled="Boolean(archiveBackupBusy)" @click="emit('archive-backup', 'open-folder')">Open backup folder</button>
        </div>
        <small>Restore is staged for restart and first preserves the current archive as an emergency backup.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Collection progress</p>
        <h3>Monster Infrequent counting</h3>
        <label class="settings-toggle">
          <input v-model="miCountingMode" type="radio" value="base" />
          <span>
            <strong>Count each MI base once</strong>
            <small>Recommended. Owning any level tier completes that named base; exact tiers remain visible and retrievable.</small>
          </span>
        </label>
        <label class="settings-toggle">
          <input v-model="miCountingMode" type="radio" value="tier" />
          <span>
            <strong>Count every level tier</strong>
            <small>Strict mode. Each obtainable required-level variant is a separate collection entry.</small>
          </span>
        </label>
        <small>This changes completion statistics only. Farming, Skill Explorer, and Leveling Planner always retain the full MI tier catalog; stored copies are never merged or discarded.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Legacy tools</p>
        <h3>Stash Scanner</h3>
        <label class="settings-toggle">
          <input type="checkbox" :checked="showLegacyScanner" @change="emit('set-legacy-scanner-visible', ($event.target as HTMLInputElement).checked)" />
          <span><strong>Show legacy stash scanner</strong><small>Expose physical-stash source controls and the diagnostic Stash Scanner collection mode.</small></span>
        </label>
        <small>The Codex Archive remains the default and recommended collection source.</small>
      </article>

      <article v-if="showLegacyScanner" class="settings-card source-settings">
        <header>
          <div><p class="section-label">Stash Scanner</p><h3>Physical copy sources</h3></div>
          <div class="source-presets">
            <button type="button" @click="emit('select-source-mode', 'stashes', false)">SC</button>
            <button type="button" @click="emit('select-source-mode', 'stashes', true)">HC</button>
          </div>
        </header>
        <p>Controls which Grim Dawn stash files the diagnostic scanner reads. These counts are separate from copies stored in the Codex Archive.</p>
        <div class="settings-source-list">
          <label v-for="stash in stashChoices" :key="`index:${stash.path}`" class="source-option">
            <input
              type="checkbox"
              :checked="indexStashPaths.includes(stash.path)"
              :disabled="indexStashPaths.length === 1 && indexStashPaths.includes(stash.path)"
              @change="emit('toggle-source', 'stashes', stash.path)"
            />
            <span :class="stash.isHardcore ? 'hardcore' : 'softcore'">{{ stash.isHardcore ? 'HC' : 'SC' }}</span>
            <div><strong>{{ stash.modLabel || 'Base game' }}</strong><small>{{ stash.path }}</small></div>
          </label>
        </div>
      </article>

      <article class="settings-card source-settings">
        <header>
          <div><p class="section-label">Codex Archive</p><h3>Archive mode scope</h3></div>
        </header>
        <p>Archive copies retain their game mode, not an originating stash. Enable either mode or both.</p>
        <div class="archive-mode-options">
          <label class="archive-mode-option">
            <input
              type="checkbox"
              :checked="archiveModeEnabled(false)"
              :disabled="archiveModeCount === 1 && archiveModeEnabled(false)"
              @change="emit('set-archive-mode', false, ($event.target as HTMLInputElement).checked)"
            />
            <span class="mode-badge softcore">SC</span>
            <span><strong>Softcore</strong><small>Show archived Softcore copies.</small></span>
          </label>
          <label class="archive-mode-option">
            <input
              type="checkbox"
              :checked="archiveModeEnabled(true)"
              :disabled="archiveModeCount === 1 && archiveModeEnabled(true)"
              @change="emit('set-archive-mode', true, ($event.target as HTMLInputElement).checked)"
            />
            <span class="mode-badge hardcore">HC</span>
            <span><strong>Hardcore</strong><small>Show archived Hardcore copies.</small></span>
          </label>
        </div>
      </article>

      <article class="settings-card retrieval-settings">
        <p class="section-label">Retrieval</p>
        <h3>Closed-game transfer target</h3>
        <select v-model="selectedStashPath" :disabled="vaultBusy">
          <option v-for="stash in stashChoices" :key="stash.path" :value="stash.path">
            {{ stash.isHardcore ? 'Hardcore' : 'Softcore' }} · {{ stash.path }}
          </option>
        </select>
        <small>Live retrieval always targets {{ liveStatus?.depositTabDescription ?? 'the second-to-last shared stash tab' }}.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Stored supplies</p>
        <h3>Dispensing behavior</h3>
        <label class="settings-toggle">
          <input
            type="checkbox"
            :checked="infiniteSupplies"
            :disabled="infiniteSuppliesBusy || vaultBusy"
            @change="emit('set-infinite-supplies', ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>Infinite supplies</strong>
            <small>Keep an unlocked faction boost, difficulty merit, Nemesis warrant, augment, or movement rune after dispensing one copy.</small>
          </span>
        </label>
        <small v-if="infiniteSupplies">Each return emits one unit; the archived unlock remains available.</small>
        <small v-else>Disabled: returning a stored supply consumes that archived stack like an ordinary item.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Game data</p>
        <h3>Installed-data cache</h3>
        <p>Item records, drop-source graphs, map regions, and monster placements are cached locally. Game updates invalidate the cache automatically.</p>
        <button class="settings-action" type="button" :disabled="scanning" @click="emit('rebuild-game-data-index')">
          {{ scanning && scanActivity === 'game-data' ? 'Rebuilding index…' : 'Rebuild game-data index' }}
        </button>
        <small>Use this after changing mods or if a location looks stale.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Lost quest-item recovery</p>
        <h3>Sahdina’s Memento fixer</h3>
        <p>Crate left this secret necklace sellable. Create exactly one clean replacement through CC’s verified live-delivery queue.</p>
        <div class="settings-status">
          <span class="status-dot" :class="{ dim: liveStatus?.state !== 'ready' }" />
          <span>
            <strong>{{ liveStatus?.state === 'ready' ? 'Grim Dawn connected' : 'Live game required' }}</strong>
            {{ liveStatus?.state === 'ready' ? 'Choose the active character inventory or verified shared-stash destination.' : 'Connect from the app header before recovering the item.' }}
          </span>
        </div>
        <div class="interface-recovery-actions">
          <button
            class="settings-action"
            type="button"
            :disabled="vaultBusy || liveStatus?.state !== 'ready'"
            @click="emit('recover-sahdina', 'character-inventory')"
          >{{ sahdinaRecoveryBusy === 'character-inventory' ? 'Delivering…' : 'Recover to inventory' }}</button>
          <button
            class="settings-action"
            type="button"
            :disabled="vaultBusy || liveStatus?.state !== 'ready'"
            @click="emit('recover-sahdina', 'shared-stash')"
          >{{ sahdinaRecoveryBusy === 'shared-stash' ? 'Delivering…' : 'Recover to shared stash' }}</button>
        </div>
        <small>Use this only if the original secret quest item was accidentally sold or otherwise lost.</small>
      </article>

      <article class="settings-card">
        <p class="section-label">Support and recovery</p>
        <h3>Local diagnostics</h3>
        <div v-if="recoveryStatus?.requiresAttention" class="recovery-alert">
          <strong>Pause transfers</strong>
          <span>{{ recoveryStatus.operations.length }} journal operation{{ recoveryStatus.operations.length === 1 ? '' : 's' }} require a recovery audit.</span>
          <code v-for="operation in recoveryStatus.operations.slice(0, 5)" :key="operation.id">
            {{ operation.operation }} · {{ operation.state }} · {{ operation.id }}
          </code>
        </div>
        <label class="settings-toggle">
          <input
            type="checkbox"
            :checked="debugLoggingStatus.enabled"
            :disabled="debugLoggingBusy"
            @change="emit('set-debug-logging', ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>Debug logging</strong>
            <small>Capture additional helper timings for up to {{ debugLoggingStatus.maxAgeDays }} days. Logs rotate after {{ debugLoggingStatus.maxFiles }} bounded files and never include item payloads or character names.</small>
          </span>
        </label>
        <p>Export one redacted JSON support bundle with rotating logs, job timings, versions and fingerprints, database integrity, and unfinished-operation state. Personal paths, character names, item payloads, saves, archives, queues, receipts, and credentials are excluded.</p>
        <button class="settings-action" type="button" :disabled="diagnosticsBusy" @click="emit('export-diagnostics')">
          {{ diagnosticsBusy ? 'Collecting diagnostics…' : 'Export redacted support bundle' }}
        </button>
        <button class="settings-action" type="button" :disabled="preferenceExportBusy" @click="emit('export-preferences')">
          {{ preferenceExportBusy ? 'Exporting preferences…' : 'Export preferences' }}
        </button>
        <small>Preference exports contain your planner profiles, to-dos, and configured local source paths. Keep them private; use the redacted support bundle for public bug reports.</small>
        <button class="settings-action" type="button" @click="emit('open-data-directory')">Open data and backups folder</button>
        <div class="interface-recovery-actions">
          <button class="settings-action" type="button" @click="emit('reset-interface-preferences')">Reset interface preferences</button>
          <button v-if="safeModeActive" class="settings-action" type="button" :disabled="safeModeBusy" @click="emit('restart-safe-mode', false)">Restart normally</button>
          <button v-else class="settings-action" type="button" :disabled="safeModeBusy" @click="emit('restart-safe-mode', true)">Restart in safe mode</button>
        </div>
        <small>Interface reset preserves the Codex Archive, planner profiles, to-do list, source selection, saves, stashes, and backups.</small>
        <small>Standard diagnostics retain at most 3 × 256 KB for 7 days. Debug mode retains at most 6 × 1 MB for 14 days. Preserve the data folder after an uncertain transfer, but never post saves or the archive database publicly.</small>
      </article>
    </div>
  </section>
</template>
