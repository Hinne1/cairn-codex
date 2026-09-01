import assert from 'node:assert/strict'
import { compileSearchQuery } from '../src/shared/search-query.ts'

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

console.log(JSON.stringify({
  passed: true,
  precedence: true,
  quotedFields: true,
  negation: true,
  numericComparisons: true,
  aliases: true,
  unicode: true,
  safeErrors: true
}, null, 2))
