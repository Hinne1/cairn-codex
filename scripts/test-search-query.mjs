import assert from 'node:assert/strict'
import {
  buildAdvancedSearchQuery,
  parseAdvancedSearchDraft
} from '../src/shared/advanced-search.ts'
import { compileSearchQuery } from '../src/shared/search-query.ts'
import { searchHelp, searchQueryOptions, searchSchemas } from '../src/shared/search-schema.ts'

const options = {
  fields: ['name', 'skill', 'damage', 'slot', 'rarity', 'level', 'owned', 'affix'],
  aliases: { type: 'slot' },
  numericFields: ['level']
}
const item = {
  text: 'Mythical Wendigo Spellweaver Vitality Damage Amulet Legendary',
  fields: {
    name: 'Mythical Wendigo Spellweaver',
    skill: ['Wendigo Totem', 'Devouring Swarm'],
    damage: ['Vitality Damage', 'Vitality Decay'],
    slot: 'Amulet',
    rarity: 'Legendary',
    level: 94,
    owned: true,
    affix: ['Devouring', 'of the Wild']
  }
}

function matches(query, document = item) {
  const compiled = compileSearchQuery(query, options)
  assert.equal(compiled.error, null, `Unexpected parse error for ${query}: ${compiled.error?.message}`)
  return compiled.matches(document)
}

assert(matches('wendigo vitality'))
const separateDamageWords = { text: 'Frost armor: Cold Damage, Aether Resistance', fields: {} }
assert(matches('aether damage', separateDamageWords), 'Unquoted search remains AND word matching')
assert(!matches('"aether damage"', separateDamageWords), 'Quoted damage phrases must not match a resistance and unrelated damage')
assert(matches('"aether damage"', { text: '25% Aether Damage', fields: {} }))
assert(matches('skill:wendigo AND "vitality damage"'))
assert(matches('skill:"wendigo totem" rarity:legendary'))
assert(matches('slot:amulet OR slot:ring'))
assert(matches('(slot:ring OR slot:amulet) AND level:>=90'))
assert(matches('NOT rarity:epic'))
assert(matches('-rarity:epic'))
assert(matches('owned:yes'))
assert(matches('type:amulet'))
assert(matches('affix:devouring'))
assert(!matches('slot:ring OR rarity:epic'))
assert(!matches('skill:wendigo -damage:vitality'))
assert(matches('name:ö', { text: 'Sól', fields: { name: 'Ördög', level: 1 } }))

for (const [query, message] of [
  ['skill:"wendigo', 'closing quote'],
  ['skill:', 'cannot be empty'],
  ['(wendigo', 'closing parenthesis'],
  ['wendigo OR', 'both sides'],
  ['unknown:value', 'Unknown search field'],
  ['level:ancient', 'needs a number']
]) {
  const compiled = compileSearchQuery(query, options)
  assert(compiled.error, `Expected ${query} to fail`)
  assert.match(compiled.error.message, new RegExp(message, 'i'))
  assert(compiled.matches(item), 'Invalid queries must preserve the unfiltered surface')
}

const collectionOptions = searchQueryOptions(searchSchemas.collection)
assert.deepEqual(collectionOptions.fields, searchSchemas.collection.fields.map((field) => field.name))
assert.deepEqual(collectionOptions.numericFields, ['level'])
for (const schema of Object.values(searchSchemas)) {
  const schemaOptions = searchQueryOptions(schema)
  assert.deepEqual(schemaOptions.fields, schema.fields.map((field) => field.name), `${schema.key} parser fields drifted`)
  for (const field of schema.fields) {
    assert.match(searchHelp(schema), new RegExp(`\\b${field.name}\\b`), `${schema.key} help omitted ${field.name}`)
    for (const value of field.values ?? []) {
      const suggested = compileSearchQuery(`${field.name}:${value}`, schemaOptions)
      assert.equal(suggested.error, null, `${schema.key} suggests an invalid ${field.name} value: ${value}`)
      assert(suggested.matches({ text: '', fields: { [field.name]: value } }), `${schema.key} suggestion does not match its canonical value: ${field.name}:${value}`)
    }
  }
  for (const example of schema.examples) {
    assert.equal(compileSearchQuery(example, schemaOptions).error, null, `${schema.key} example is invalid: ${example}`)
  }
}

const allRules = {
  combinator: 'all',
  preservedQuery: '',
  rules: [
    { id: 1, field: 'skill', operator: 'exact', value: 'Wendigo Totem', negated: false },
    { id: 2, field: 'level', operator: 'at-least', value: '75', negated: false },
    { id: 3, field: 'rarity', operator: 'is-not', value: 'epic', negated: false }
  ]
}
const builtAll = buildAdvancedSearchQuery(allRules, searchSchemas.collection)
assert.equal(builtAll.error, null)
assert.equal(builtAll.query, 'skill:"Wendigo Totem" AND level:>=75 AND NOT rarity:epic')
assert.equal(compileSearchQuery(builtAll.query, collectionOptions).error, null)

const anyRules = {
  combinator: 'any',
  preservedQuery: '',
  rules: [
    { id: 4, field: 'rarity', operator: 'is', value: 'legendary', negated: false },
    { id: 5, field: 'slot', operator: 'is', value: 'amulet', negated: false },
    { id: 6, field: 'damage', operator: 'is-not', value: 'aether', negated: false }
  ]
}
const builtAny = buildAdvancedSearchQuery(anyRules, searchSchemas.collection)
assert.equal(builtAny.error, null)
assert.equal(builtAny.query, '(rarity:legendary OR slot:amulet) AND NOT damage:aether')
const roundTrip = parseAdvancedSearchDraft(builtAny.query, searchSchemas.collection)
assert.equal(roundTrip.representable, true)
assert.equal(buildAdvancedSearchQuery(roundTrip.draft, searchSchemas.collection).query, builtAny.query)

const aliased = parseAdvancedSearchDraft('class:amulet', searchSchemas.collection)
assert.equal(aliased.representable, true)
assert.equal(aliased.draft.rules[0]?.field, 'type')

for (const [query, operator] of [['level:>75', 'greater-than'], ['level:<94', 'less-than']]) {
  const parsed = parseAdvancedSearchDraft(query, searchSchemas.collection)
  assert.equal(parsed.representable, true)
  assert.equal(parsed.draft.rules[0]?.operator, operator)
  assert.equal(buildAdvancedSearchQuery(parsed.draft, searchSchemas.collection).query, query)
}

for (const [comparison, operator] of [
  ['>=', 'at-least'], ['<=', 'at-most'], ['>', 'greater-than'], ['<', 'less-than']
]) {
  const query = `NOT level:${comparison}75.5`
  const parsed = parseAdvancedSearchDraft(query, searchSchemas.collection)
  assert.equal(parsed.representable, true)
  assert.equal(parsed.draft.rules[0]?.operator, operator)
  assert.equal(parsed.draft.rules[0]?.negated, true)
  assert.equal(buildAdvancedSearchQuery(parsed.draft, searchSchemas.collection).query, query)
}

for (const query of [
  'rarity:epic OR NOT damage:aether',
  'NOT rarity:epic OR NOT damage:aether',
  '(rarity:epic OR NOT damage:aether) AND NOT slot:ring'
]) {
  const parsed = parseAdvancedSearchDraft(query, searchSchemas.collection)
  assert.equal(parsed.representable, false)
  assert.equal(parsed.draft.preservedQuery, query)
}

assert.deepEqual(searchSchemas.materials.fields.find((field) => field.name === 'slot')?.values, ['component', 'material', 'potion-formula'])
assert.deepEqual(searchSchemas.supplies.fields.find((field) => field.name === 'slot')?.values, ['weapon', 'armor', 'jewelry'])
assert(searchSchemas.collection.fields.find((field) => field.name === 'slot')?.values?.includes('waist'))
assert(searchSchemas.collection.fields.find((field) => field.name === 'slot')?.values?.includes('offhand'))
assert(searchSchemas.collection.fields.find((field) => field.name === 'slot')?.values?.includes('shield'))

const complexQuery = '(slot:amulet OR slot:medal) AND (rarity:epic OR rarity:legendary)'
const preserved = parseAdvancedSearchDraft(complexQuery, searchSchemas.collection)
assert.equal(preserved.representable, false)
assert.equal(preserved.draft.preservedQuery, complexQuery)
preserved.draft.rules[0] = { id: 7, field: 'level', operator: 'at-least', value: '75', negated: false }
assert.equal(
  buildAdvancedSearchQuery(preserved.draft, searchSchemas.collection).query,
  `(${complexQuery}) AND (level:>=75)`
)

const invalidPreserved = parseAdvancedSearchDraft('skill:"wendigo', searchSchemas.collection)
assert.equal(invalidPreserved.representable, false)
assert.equal(invalidPreserved.draft.preservedQuery, 'skill:"wendigo')
assert.match(buildAdvancedSearchQuery({ ...invalidPreserved.draft, preservedQuery: '' }, searchSchemas.collection).query, /^$/)

assert.match(buildAdvancedSearchQuery({
  combinator: 'all',
  preservedQuery: '',
  rules: [{ id: 8, field: 'level', operator: 'at-least', value: 'ancient', negated: false }]
}, searchSchemas.collection).error ?? '', /needs a number/i)
assert.equal(buildAdvancedSearchQuery({
  combinator: 'all',
  preservedQuery: '',
  rules: [{ id: 9, field: 'level', operator: 'at-least', value: 'ancient', negated: false }]
}, searchSchemas.collection).errorRuleId, 9)

console.log(JSON.stringify({
  passed: true,
  precedence: true,
  quotedFields: true,
  negation: true,
  numericComparisons: true,
  aliases: true,
  unicode: true,
  safeErrors: true,
  schemaDrivenGuidance: true,
  advancedBuilder: true,
  advancedRoundTrip: true,
  negatedComparisons: true,
  workspaceChoiceValues: true,
  unsupportedSyntaxPreserved: true
}, null, 2))
