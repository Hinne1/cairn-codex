import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveActiveCharacter } from '../src/renderer/src/live-presence.ts'

const profile = (name, isHardcore = false, lastWriteUtc = '2026-09-01T12:00:00Z') => ({ name, isHardcore, lastWriteUtc, error: null })
const profiles = [profile('Newest', false, '2026-09-02T12:00:00Z'), profile('Confirmed'), profile('Confirmed', true), profile('Confírmed')]
const ready = { state: 'ready', grimDawnProcessIds: [42], isHardcore: false, activeCharacterName: 'CONFIRMED' }
assert.equal(resolveActiveCharacter(ready, profiles), profiles[1])
assert.equal(resolveActiveCharacter({ ...ready, isHardcore: true }, profiles), profiles[2])
assert.equal(resolveActiveCharacter({ ...ready, activeCharacterName: 'Confírmed' }, profiles), profiles[3])
for (const status of [null, { ...ready, state: 'blocked' }, { ...ready, grimDawnProcessIds: [] },
  { ...ready, isHardcore: null }, { ...ready, activeCharacterName: null },
  { ...ready, activeCharacterName: '   ' }, { ...ready, activeCharacterName: 'Missing' }]) {
  assert.equal(resolveActiveCharacter(status, profiles), null, 'unconfirmed identity cannot fall back to save recency')
}
assert.equal(resolveActiveCharacter(ready, [{ ...profiles[1], error: 'unreadable' }]), null)
assert.equal(resolveActiveCharacter({ ...ready, activeCharacterName: 'Newest' }, profiles), profiles[0])
const helper = await readFile(new URL('../src/helper/CairnCodex.GrimDawn/LiveGameAdapter.cs', import.meta.url), 'utf8')
assert.match(helper, /if \(type == TypeActiveCharacter\)\s*\{\s*activeCharacterName = DecodeActiveCharacter\(data\)/)
assert.doesNotMatch(helper, /isHardcore = null;\s*(?:currentState =|throw new WriteSafetyException)/,
  'connection loss must clear the confirmed identity with mode')
console.log('Live presence passed: exact confirmed name/mode, no recency fallback, disconnect and unknown identity.')
