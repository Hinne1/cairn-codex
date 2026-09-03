import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  defaultWorkspaceToolIds,
  essentialWorkspaceToolIds,
  settingsArchiveModeCount,
  settingsArchiveModeEnabled,
  settingsOnboardingStatusLabel,
  workspaceToolDefinitions
} from '../src/renderer/src/workspaces/settings.ts'

const stashes = [
  { path: 'C:\\Saves\\transfer.gst', isHardcore: false, modLabel: '' },
  { path: 'C:\\Saves\\transfer.gsh', isHardcore: true, modLabel: '' }
]

assert.equal(settingsOnboardingStatusLabel('completed', 0), 'Completed')
assert.equal(settingsOnboardingStatusLabel('skipped', 2), 'Skipped · resume any time')
assert.equal(settingsOnboardingStatusLabel('in-progress', 2), 'In progress · step 3')
assert.equal(settingsArchiveModeEnabled(stashes, [stashes[0].path], false), true)
assert.equal(settingsArchiveModeEnabled(stashes, [stashes[0].path], true), false)
assert.equal(settingsArchiveModeCount(stashes, [stashes[0].path]), 1)
assert.equal(settingsArchiveModeCount(stashes, stashes.map((stash) => stash.path)), 2)
assert.equal(defaultWorkspaceToolIds.length, workspaceToolDefinitions.length)
assert.deepEqual(
  workspaceToolDefinitions.filter((tool) => tool.experimental).map((tool) => tool.id),
  ['oracle', 'dismantling']
)
assert.deepEqual(essentialWorkspaceToolIds, ['sets', 'skills', 'planner', 'mi-workshop', 'supplies'])

const [app, workspace] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/SettingsWorkspace.vue', import.meta.url), 'utf8')
])

assert.match(app, /<SettingsWorkspace[\s\S]*?v-model:mi-counting-mode="miCountingMode"[\s\S]*?v-model:selected-stash-path="selectedStashPath"/)
assert.match(app, /@archive-backup="handleArchiveBackupAction"/)
assert.match(app, /@restart-safe-mode="handleSafeModeRestart"/)
assert.match(app, /:tooltip-boundary-scroll="tooltipBoundaryScroll"[\s\S]*?@set-tooltip-boundary-scroll="tooltipBoundaryScroll = \$event"/)
assert.doesNotMatch(app, /<section v-else-if="activeView === 'settings'"/)
assert.doesNotMatch(app, /class="settings-grid"/)
assert.doesNotMatch(app, /Sahdina’s Memento fixer/)

assert.match(workspace, /defineModel<MiCountingMode>\('miCountingMode'/)
assert.match(workspace, /defineModel<string>\('selectedStashPath'/)
assert.match(workspace, /settingsArchiveModeCount\(props\.stashChoices, props\.archiveStashPaths\)/)
assert.match(workspace, /<ItemAssistantImport[\s\S]*?gdia-import-completed/)
assert.match(workspace, /Enable experimental tools/)
assert.match(workspace, /Verified rotating backups/)
assert.match(workspace, /Sahdina’s Memento fixer/)
assert.match(workspace, /Export redacted support bundle/)
assert.match(workspace, /Tooltip edge scrolling[\s\S]*?Continue into the page[\s\S]*?Keep scrolling in the tooltip/)
assert.equal((workspace.match(/<article\b/g) ?? []).length, 14, 'all fourteen Settings cards must remain workspace-owned')

const electronGate = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
assert.match(electronGate, /VERIFY_SETTINGS_WORKSPACE[\s\S]*?MI counting v-model did not update the persisted parent ref/)
assert.match(electronGate, /Contained tooltip-edge scrolling did not persist through Settings/)
assert.match(electronGate, /Retrieval-target v-model did not update the persisted parent ref/)
assert.match(electronGate, /Experimental-tools emit did not update the persisted shell preference/)
assert.match(electronGate, /Disabling one archive mode did not protect the remaining mode/)
assert.match(electronGate, /Safe mode did not disable auto-connect and experimental tools/)

console.log('Settings workspace passed: pure status/scope model, fourteen owned cards, and executable model/event/safety integration gates.')
