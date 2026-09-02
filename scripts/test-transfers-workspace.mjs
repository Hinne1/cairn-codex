import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createTransfersSession,
  formatOperationSource,
  formatTransferTimestamp,
  transferSearchError
} from '../src/renderer/src/workspaces/transfers.ts'

const session = createTransfersSession()
assert.equal(session.mode.value, 'live')
assert.equal(session.section.value, 'ingest-history')
assert.equal(session.historyPage.value, 1)
assert.equal(session.quarantinePage.value, 1)
assert.equal(session.historyStructuredQuery.value.error, null)

session.historyQuery.value = 'outcome:failed AND item:"Mythical Helm"'
assert.equal(session.historyStructuredQuery.value.error, null)
session.vaultQuery.value = 'name:"unterminated'
assert.ok(transferSearchError(session.vaultStructuredQuery.value)?.includes('unterminated'))
assert.equal(formatOperationSource('item-assistant'), 'Item Assistant import')
assert.equal(formatOperationSource('live'), 'Live game')
assert.equal(formatOperationSource('offline'), 'Offline shared stash')
assert.ok(formatTransferTimestamp('2026-09-02T10:00:00.000Z').length > 0)

const workspace = await readFile(new URL('../src/renderer/src/workspaces/TransfersWorkspace.vue', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')
assert.doesNotMatch(workspace, /window\.cairnCodex|localStorage|preferenceRepository/)
assert.match(workspace, /Ingest history/)
assert.match(workspace, /Dispense history/)
assert.match(workspace, /Quarantined items/)
assert.match(workspace, /v-model:selected-keys="selectedVaultIds"/)
assert.match(workspace, /emit\('retrieve-selected-live'\)/)
assert.match(workspace, /emit\('retrieve-selected'\)/)
assert.match(app, /<TransfersWorkspace[\s\S]*?:session="transfersSession"/)
assert.doesNotMatch(app, /<section v-else-if="activeView === 'vault'"/)

console.log('Transfers workspace passed: shared typed session, structured queries, owned history/quarantine presentation, and narrow shell callbacks.')
