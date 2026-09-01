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
  }
  for (const example of schema.examples) {
    assert.equal(compileSearchQuery(example, schemaOptions).error, null, `${schema.key} example is invalid: ${example}`)
  }
}

const allRules = {
  combinator: 'all',
  preservedQuery: '',
  rules: [
    { id: 1, field: 'skill', operator: 'exact', value: 'Wendigo Totem' },
    { id: 2, field: 'level', operator: 'at-least', value: '75' },
    { id: 3, field: 'rarity', operator: 'is-not', value: 'epic' }
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
    { id: 4, field: 'rarity', operator: 'is', value: 'legendary' },
    { id: 5, field: 'slot', operator: 'is', value: 'amulet' },
    { id: 6, field: 'damage', operator: 'is-not', value: 'aether' }
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

const complexQuery = '(slot:amulet OR slot:medal) AND (rarity:epic OR rarity:legendary)'
const preserved = parseAdvancedSearchDraft(complexQuery, searchSchemas.collection)
assert.equal(preserved.representable, false)
assert.equal(preserved.draft.preservedQuery, complexQuery)
preserved.draft.rules[0] = { id: 7, field: 'level', operator: 'at-least', value: '75' }
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
  rules: [{ id: 8, field: 'level', operator: 'at-least', value: 'ancient' }]
}, searchSchemas.collection).error ?? '', /needs a number/i)

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
  unsupportedSyntaxPreserved: true
}, null, 2))
