import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { updateDismantlingControls, createDismantlingSession } from '../src/renderer/src/workspaces/dismantling.ts'

const controls = { query: '', mode: 'all', rarity: 'all' }
assert.deepEqual(updateDismantlingControls(controls, { mode: 'hardcore' }), {
  query: '', mode: 'hardcore', rarity: 'all'
})
assert.deepEqual(controls, { query: '', mode: 'all', rarity: 'all' })
const first = createDismantlingSession(), second = createDismantlingSession()
first.selectedIds.value = ['copy-a']
assert.deepEqual(second.selectedIds.value, [], 'workspace sessions do not share selection')

const [app, workspace] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/DismantlingWorkspace.vue', import.meta.url), 'utf8')
])
assert.match(app, /<DismantlingWorkspace[\s\S]*?v-else-if="activeView === 'dismantling'"/)
assert.match(app, /v-model:controls="dismantlingControls"/)
assert.match(app, /:preview-dismantling="previewDismantling"/)
assert.doesNotMatch(app, /refreshFullVaultItems|cairnCodex\.listVaultItems\(/)
assert.match(workspace, /:remote="true"/)
assert.match(workspace, /:page-size="120"/)
assert.doesNotMatch(workspace, /window\.cairnCodex|filterDismantlingCandidates|selectRedundantDismantlingCandidateIds/)
console.log('Dismantling workspace controls, isolated session state and bounded repository boundary passed.')
