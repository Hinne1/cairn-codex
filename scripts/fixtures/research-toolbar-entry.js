import { createApp, h, ref, shallowRef } from 'vue'
import Planner from '../../src/renderer/src/workspaces/LevelingPlannerWorkspace.vue'
import Explorer from '../../src/renderer/src/workspaces/SkillExplorerWorkspace.vue'
import Toolbar from '../../src/renderer/src/components/ExplorerToolbar.vue'
import { createPreferenceRepository } from '../../src/renderer/src/preference-repository'
import { createLevelingPlannerSession } from '../../src/renderer/src/workspaces/leveling-planner'
import { searchGuidance } from '../../src/renderer/src/search-guidance'
import '../../src/renderer/src/semantic-tokens.css'
import '../../src/renderer/src/styles.css'

// Synthetic, memory-only data: no preload bridge or personal profile is loaded.
const copy = value => JSON.parse(JSON.stringify(value))
const values = new Map()
const repository = createPreferenceRepository({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) })
const profile = id => ({ id, name: id, source: 'manual', skills: ['Wendigo Totem'], masteries: [], excludedSkills: [], ignoredRecords: [], minimumLevel: 1, levelCap: 100, modifiedAt: '2026-09-04T00:00:00Z' })
repository.update('planner', { profiles: [profile('Alpha plan'), profile('Beta plan')], selectedProfileId: 'Alpha plan' })
const makeItem = index => ({
  record: `records/fixture-${index}.dbr`, name: `Fixture ${String(index).padStart(5, '0')}`, rarity: 'legendary', slot: 'head', itemClass: 'ArmorProtective_Head',
  levelRequirement: index % 100 + 1, discovered: false, availableCount: 0, bestRollPercentile: null,
  presentation: { sections: [{ kind: 'base', lines: [{ label: 'to Wendigo Totem', minimum: 2, maximum: null, unit: '', prefix: '+', suffix: '', tone: 'skill' }] }] },
  acquisition: { sources: ['Fixture monster'], factions: [], locations: [] }
})
const items = shallowRef(Array.from({ length: 120 }, (_, index) => makeItem(index)))
const workspace = ref('planner')
const controls = ref({ skill: 'Wendigo Totem', query: '', scope: 'all', rarity: 'all', slot: 'all', sort: 'level', direction: 'asc', page: 1 })
const probeQuery = ref('')
const probeLoading = ref(true)
const probeError = ref(null)
const skillNames = ['Wendigo Totem', 'Curse of Frailty']
createApp({ setup() {
  const session = createLevelingPlannerSession({
    initialPreferences: repository.value, items: () => items.value, snapshot: () => ({ items: items.value }),
    skillNames: () => skillNames, archivedRecords: () => new Set(), isArchivedItem: () => false, ownershipLabel: () => null,
    itemSearchDocument: item => ({ text: item.name, fields: {} }), formatPresentationLine: line => `${line.minimum} ${line.label}`,
    persistPlanner: patch => repository.update('planner', copy(patch)), persistDisplay: plannerDisplay => repository.update('appearance', { plannerDisplay }),
    listCharacters: async () => [], readableError: error => error.message, reportProblem: () => {}, reportSuccess: () => {}
  })
  window.researchFixture = { workspace, session, controls, repository, probeLoading, probeError,
    setCount: count => { items.value = Array.from({ length: count }, (_, index) => makeItem(index)) } }
  return () => h('main', { style: 'padding:16px; min-width:0' }, [
    workspace.value === 'planner' ? h(Planner, { session, iconUrlForItem: () => null, contentPackLabel: pack => pack }) :
    workspace.value === 'skills' ? h(Explorer, { items: items.value, skillNames, controls: controls.value, 'onUpdate:controls': value => { controls.value = value }, isArchivedItem: () => false, archivedRecords: new Set(), iconUrlForItem: () => null, ownershipLabelForItem: () => null }) :
    h(Toolbar, { ...searchGuidance.skillItems, layout: 'research', modelValue: probeQuery.value, 'onUpdate:modelValue': value => { probeQuery.value = value }, loading: probeLoading.value, searchError: probeError.value })
  ])
} }).mount('#app')
