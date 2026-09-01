import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import {
  createStashOracleView,
  surpriseStashOracle,
  updateStashOracleControls
} from '../src/renderer/src/workspaces/stash-oracle.ts'

const controls = {
  query: '',
  characterClass: 'all',
  style: 'all',
  readiness: 'all',
  minimumLevel: 1,
  maximumLevel: 100,
  sort: 'score',
  direction: 'desc',
  page: 4
}

assert.deepEqual(updateStashOracleControls(controls, { query: 'vitality' }, true), {
  ...controls,
  query: 'vitality',
  page: 1
})
assert.deepEqual(updateStashOracleControls(controls, { sort: 'name' }, false), {
  ...controls,
  sort: 'name'
})
assert.deepEqual(surpriseStashOracle({
  ...controls,
  query: 'skill:wendigo',
  characterClass: 'Conjurer',
  style: 'pets',
  readiness: 'near'
}), { ...controls, page: 1 })
assert.equal(controls.page, 4)

function candidate(overrides) {
  return {
    key: 'candidate',
    title: 'Candidate',
    skill: 'Skill',
    damageType: 'Physical',
    style: 'weapon',
    anchorSet: null,
    score: 50,
    readiness: 'near',
    ownedCore: 2,
    coreSize: 4,
    masteries: ['Soldier'],
    className: 'Warlord',
    relatedSkills: [],
    evidence: [],
    sets: [],
    conflicts: [],
    summary: 'Summary',
    ...overrides
  }
}

const candidates = [
  candidate({ key: 'wendigo', title: 'Wendigo Vitality', skill: 'Wendigo Totem', damageType: 'Vitality', score: 91, readiness: 'ready', masteries: ['Shaman', 'Occultist'], className: 'Conjurer' }),
  candidate({ key: 'raven', title: 'Storm Raven', skill: 'Summon Familiar', damageType: 'Lightning', style: 'pets', score: 64, readiness: 'near', masteries: ['Occultist', 'Arcanist'], className: 'Warlock' }),
  candidate({ key: 'cadence', title: 'Cadence Physical', skill: 'Cadence', score: 24, readiness: 'wildcard' })
]

const all = createStashOracleView(candidates, controls, compileSearchQuery(''))
assert.deepEqual(all.classOptions, ['Conjurer', 'Warlock', 'Warlord'])
assert.deepEqual(all.readinessCounts, { ready: 1, near: 1, wildcard: 1 })
assert.deepEqual(all.filteredCandidates.map((entry) => entry.key), ['wendigo', 'raven', 'cadence'])

const classFiltered = createStashOracleView(candidates, {
  ...controls,
  characterClass: 'conjurer',
  readiness: 'ready'
}, compileSearchQuery('skill:wendigo AND vitality'))
assert.deepEqual(classFiltered.readinessCounts, { ready: 1, near: 0, wildcard: 0 })
assert.deepEqual(classFiltered.filteredCandidates.map((entry) => entry.key), ['wendigo'])

const spacingInsensitive = createStashOracleView(candidates, {
  ...controls,
  characterClass: 'War-lord'
}, compileSearchQuery(''))
assert.deepEqual(spacingInsensitive.candidates.map((entry) => entry.key), ['cadence'])

const unicodeInsensitive = createStashOracleView([
  candidate({ key: 'unicode', className: 'Café Hunter' })
], {
  ...controls,
  characterClass: 'CafeHunter'
}, compileSearchQuery(''))
assert.deepEqual(unicodeInsensitive.candidates.map((entry) => entry.key), ['unicode'])

const ascendingNames = createStashOracleView(candidates, {
  ...controls,
  sort: 'name',
  direction: 'asc'
}, compileSearchQuery(''))
assert.deepEqual(ascendingNames.filteredCandidates.map((entry) => entry.key), ['cadence', 'raven', 'wendigo'])

const [app, workspace, viewModel] = await Promise.all([
  readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/StashOracleWorkspace.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/workspaces/stash-oracle.ts', import.meta.url), 'utf8')
])

assert.match(app, /<StashOracleWorkspace[\s\S]*?v-else-if="activeView === 'oracle'"/)
assert.match(app, /const oracleControls = ref<StashOracleControls>/)
assert.match(app, /v-model:controls="oracleControls"/)
assert.match(app, /case 'oracle':[\s\S]*?oracleControls\.value = \{[\s\S]*?\.\.\.route\.controls/)
assert.doesNotMatch(app, /const oracleQuery|const oracleClass|const oraclePage|const allOracleCandidates|const filteredOracleCandidates/)
assert.match(workspace, /defineModel<StashOracleControls>\('controls'/)
assert.match(workspace, /v-model:page="page"[\s\S]*?:items="view\.filteredCandidates"[\s\S]*?:page-size="12"/)
assert.match(workspace, /emit\('queue-tooltip', evidence\.item, \$event\)[\s\S]*?emit\('open-item', evidence\.item\)/)
assert.match(workspace, /emit\('build-plan', candidate\)/)
assert.doesNotMatch(workspace, /<article v-for=/)
assert.match(viewModel, /export function createStashOracleView/)
assert.match(viewModel, /export function surpriseStashOracle/)

console.log('Stash Oracle workspace passed: typed control ownership, deterministic filtering/sorting, global tooltip adapters, and a bounded 12-card result surface.')
