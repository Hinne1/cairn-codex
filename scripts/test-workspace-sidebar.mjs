import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createPreferenceRepository,
  PREFERENCE_STORAGE_KEY
} from '../src/renderer/src/preference-repository.ts'
import { isPreferenceDocument } from '../src/shared/preference-schema.ts'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

const fixedNow = () => '2026-09-02T08:00:00.000Z'
let nextId = 0
const createId = () => `sidebar-profile-${++nextId}`

const seedStorage = new MemoryStorage()
const seedRepository = createPreferenceRepository(seedStorage, fixedNow, createId)
const legacyV1Document = JSON.parse(seedRepository.exportJson())
delete legacyV1Document.appearance.navigationCollapsed
assert.equal(isPreferenceDocument(legacyV1Document), true, 'existing v1 preference documents must remain readable')

const migratedStorage = new MemoryStorage()
migratedStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(legacyV1Document))
const migratedRepository = createPreferenceRepository(migratedStorage, fixedNow, createId)
assert.equal(migratedRepository.value.appearance.navigationCollapsed, false)
migratedRepository.update('appearance', { navigationCollapsed: true })
assert.equal(JSON.parse(migratedStorage.getItem(PREFERENCE_STORAGE_KEY)).appearance.navigationCollapsed, true)

const [app, sidebar, icons, styles, main, modalFocus, benchmark, electronGate] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/WorkspaceSidebar.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/components/WorkspaceNavIcon.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/modal-focus.ts', import.meta.url), 'utf8'),
  readFile(new URL('./benchmark-ui.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./test-sets-bounded-results-electron.mjs', import.meta.url), 'utf8')
])

assert.match(app, /<WorkspaceSidebar[\s\S]*?v-if="snapshot && collectionSystemDestinationActive"/)
assert.match(app, /:tools="visibleWorkspaceTools"/)
assert.match(app, /:collapsed="navigationCollapsed"/)
assert.match(app, /@toggle="navigationCollapsed = !navigationCollapsed"/)
assert.doesNotMatch(app, /WorkspaceSwitcher|specialistWorkspaceActive/)
assert.match(app, /v-if="!collectionSystemDestinationActive"[\s\S]*?@click="returnToCollection"[\s\S]*?>\s*Collection/)
assert.match(app, /class="workspace-shortcuts" aria-label="Tool shortcuts"/)
assert.doesNotMatch(app, /class="workspace-shortcuts"[\s\S]*?<span>Collection<\/span><small>Items and copies<\/small>/)

assert.match(sidebar, /<nav aria-label="Collection and tools">/)
assert.match(sidebar, /data-tool-id="collection"/)
assert.match(sidebar, /aria-label="Collection"/)
assert.match(sidebar, /:aria-current="activeId === 'collection' \? 'page' : undefined"/)
assert.match(sidebar, /:aria-current="tool\.id === activeId \? 'page' : undefined"/)
assert.match(sidebar, /:aria-label="tool\.label"/)
assert.match(sidebar, /aria-label="Customize visible tools"/)
assert.match(sidebar, /:aria-expanded="!collapsed"/)
assert.match(sidebar, /import WorkspaceNavIcon from '.\/WorkspaceNavIcon\.vue'/)
assert.match(sidebar, /<WorkspaceNavIcon name="collection"/)
assert.match(sidebar, /<WorkspaceNavIcon :name="toolIcon\(tool\.id\)"/)
assert.match(sidebar, /class="workspace-nav-tooltip"/)
assert.match(sidebar, /@mouseenter="showTooltip/)
assert.match(sidebar, /@focusin="showTooltip/)
assert.match(sidebar, /@media \(max-width: 900px\)/)
assert.match(sidebar, /\.workspace-sidebar-toggle \{ display: none; \}/)
assert.doesNotMatch(sidebar, /[⌂◆◇✦↗⚒◉♜✓]/)

for (const iconName of ['collection', 'sets', 'planner', 'workshop', 'supplies', 'trivia', 'panel-collapse']) {
  assert.match(icons, new RegExp(`name === '${iconName}'`), `missing semantic navigation icon: ${iconName}`)
}
assert.match(icons, /stroke="currentColor"/)
assert.match(icons, /\.workspace-nav-svg \{[^}]*width: 22px;[^}]*height: 22px;/)
assert.match(styles, /\.workspace-layout\.has-sidebar\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin:\s*0;/)

assert.match(main, /workspace-sidebar \[data-tool-id\]/)
assert.match(main, /CAIRN_CODEX_SCREENSHOT_VERIFY_WORKSPACE_SIDEBAR/)
assert.doesNotMatch(main, /workspace-switcher|workspace-tool-rail/)
assert.match(main, /openCollectionWorkspace[\s\S]*?!collection\.isConnected[\s\S]*?collection\.click\(\)/)
assert.match(main, /Collection was duplicated in system and workspace navigation\./)
assert.match(main, /Specialist workspace retained a system-level Collection control\./)
assert.match(modalFocus, /\.workspace-sidebar button:not\(\[disabled\]\)/)
assert.match(benchmark, /--verify-workspace-sidebar/)
assert.match(electronGate, /normal[\s\S]*?--verify-workspace-sidebar/)
assert.match(electronGate, /compact 202-set paging[\s\S]*?--verify-workspace-sidebar/)

console.log(JSON.stringify({
  passed: true,
  singleNavigationModel: true,
  selectedToolsShared: true,
  densityDurable: true,
  edgeFlush: true,
  semanticIcons: true,
  collapsedTooltips: true,
  legacyPreferencesCompatible: true,
  fullScreenSystemViews: true
}, null, 2))
