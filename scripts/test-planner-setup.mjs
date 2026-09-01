import assert from 'node:assert/strict'
import {
  createCharacterPlannerProfile,
  createManualPlannerProfile,
  createPlannerClassOptions,
  plannerSkillsForMasteries
} from '../src/renderer/src/planner-setup.ts'
import { masteryMatchesForItem } from '../src/renderer/src/planner-item-matches.ts'

const classOptions = createPlannerClassOptions({
  'Occultist|Shaman': 'Conjurer',
  'Shaman|Occultist': 'Conjurer',
  'Necromancer|Soldier': 'Death Knight',
  'Soldier': 'Soldier',
  '': 'Invalid'
})
assert.deepEqual(classOptions, [
  { className: 'Conjurer', masteries: ['Occultist', 'Shaman'] },
  { className: 'Death Knight', masteries: ['Necromancer', 'Soldier'] }
])

assert.deepEqual(
  plannerSkillsForMasteries(
    ['Raise Skeletons', 'Field Command', 'Summon Briarthorn', 'Curse of Frailty'],
    {
      'Raise Skeletons': 'Necromancer',
      'Field Command': 'Soldier',
      'Summon Briarthorn': 'Shaman',
      'Curse of Frailty': 'Occultist'
    },
    ['Necromancer', 'Soldier']
  ),
  ['Raise Skeletons', 'Field Command']
)

const masteryItem = {
  presentation: {
    flavorText: null,
    searchText: '',
    grantedSkill: null,
    sections: [{
      kind: 'base',
      heading: null,
      lines: [
        { label: 'to all skills in Shaman', minimum: 1, maximum: null, unit: '', tone: 'mastery', prefix: '+', suffix: '' },
        { label: 'to all skills in SHAMAN', minimum: 2, maximum: null, unit: '', tone: 'mastery', prefix: '+', suffix: '' },
        { label: 'to all skills in Occultist', minimum: 0, maximum: null, unit: '', tone: 'mastery', prefix: '+', suffix: '' },
        { label: 'to all skills in Soldier', minimum: -1, maximum: null, unit: '', tone: 'mastery', prefix: '+', suffix: '' },
        { label: 'to Summon Briarthorn', minimum: 3, maximum: null, unit: '', tone: 'skill', prefix: '+', suffix: '' },
        { label: 'to All Skills', minimum: 1, maximum: null, unit: '', tone: 'mastery', prefix: '+', suffix: '' }
      ]
    }]
  }
}
assert.deepEqual(
  masteryMatchesForItem(masteryItem, ['Occultist', 'shaman', 'Shaman', 'Soldier']),
  [{ mastery: 'Shaman', amount: 2 }]
)
assert.deepEqual(masteryMatchesForItem(masteryItem, ['Occultist', 'Soldier']), [])
assert.deepEqual(masteryMatchesForItem(masteryItem, ['Soldier']), [])
assert.deepEqual(masteryMatchesForItem(masteryItem, []), [])

const blank = createManualPlannerProfile({
  source: 'blank',
  name: '  Vitality pets  ',
  className: 'Conjurer',
  masteries: ['Occultist', 'Shaman', 'Occultist'],
  skills: ['Summon Briarthorn', 'Curse of Frailty', 'Summon Briarthorn'],
  minimumLevel: -4,
  levelCap: 120
}, 'plan-1', '2026-09-01T12:00:00.000Z')
assert.deepEqual(blank, {
  id: 'plan-1',
  name: 'Vitality pets',
  className: 'Conjurer',
  masteries: ['Occultist', 'Shaman'],
  skills: ['Summon Briarthorn', 'Curse of Frailty'],
  excludedSkills: [],
  minimumLevel: 1,
  levelCap: 100,
  source: 'manual',
  modifiedAt: '2026-09-01T12:00:00.000Z'
})

const clone = createManualPlannerProfile({
  source: 'clone',
  cloneProfileId: 'source-plan',
  name: 'Death Knight copy',
  className: 'Death Knight',
  masteries: ['Necromancer', 'Soldier'],
  skills: ['Raise Skeletons', 'Field Command'],
  minimumLevel: 94,
  levelCap: 70
}, 'plan-2', '2026-09-01T12:00:00.000Z')
assert.equal(clone.minimumLevel, 94)
assert.equal(clone.levelCap, 94)
assert.equal(clone.source, 'manual')

const character = {
  path: 'C:\\Synthetic\\_Avaa\\player.gdc',
  name: 'Avaa', level: 84, isHardcore: true,
  classRecord: 'records/skills/playerclass02.dbr', className: 'Conjurer', factions: [],
  skills: [
    { record: 'a', name: 'Summon Briarthorn', level: 16, enabled: true },
    { record: 'b', name: 'Curse of Frailty', level: 1, enabled: true },
    { record: 'c', name: 'Unknown internal skill', level: 1, enabled: true }
  ],
  lastWriteUtc: '2026-09-01T11:30:00.000Z', error: null
}
const refreshedCharacter = createCharacterPlannerProfile({
  character,
  skillNames: ['Summon Briarthorn', 'Curse of Frailty'],
  classOptions,
  existing: {
    id: 'character-plan', name: 'Avaa', className: 'Conjurer', masteries: ['Occultist', 'Shaman'],
    skills: ['Summon Briarthorn'], excludedSkills: ['Curse of Frailty'], minimumLevel: 50, levelCap: 94,
    source: 'character', characterPath: character.path, characterLevel: 70, isHardcore: true,
    modifiedAt: '2026-08-31T12:00:00.000Z'
  },
  id: 'unused-id',
  modifiedAt: '2026-09-01T12:00:00.000Z'
})
assert.equal(refreshedCharacter.id, 'character-plan')
assert.deepEqual(refreshedCharacter.skills, ['Summon Briarthorn'])
assert.deepEqual(refreshedCharacter.excludedSkills, ['Curse of Frailty'])
assert.equal(refreshedCharacter.minimumLevel, 50)

const guidedCharacter = createCharacterPlannerProfile({
  character,
  skillNames: ['Summon Briarthorn', 'Curse of Frailty'],
  classOptions,
  setup: {
    source: 'character', characterPath: character.path, name: 'Avaa vitality', className: 'Conjurer',
    masteries: ['Occultist', 'Shaman'], skills: ['Curse of Frailty'], minimumLevel: 20, levelCap: 100
  },
  id: 'guided-character',
  modifiedAt: '2026-09-01T12:00:00.000Z'
})
assert.deepEqual(guidedCharacter.skills, ['Curse of Frailty'])
assert.deepEqual(guidedCharacter.excludedSkills, [])
assert.equal(guidedCharacter.name, 'Avaa vitality')

console.log(JSON.stringify({
  passed: true,
  combinedMasteries: classOptions.length,
  masterySkillSuggestions: 2,
  masteryWideItemMatches: true,
  blankPlan: true,
  clonedPlan: true,
  characterRefresh: true,
  guidedCharacterPlan: true
}, null, 2))
