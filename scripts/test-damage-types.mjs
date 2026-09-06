import assert from 'node:assert/strict'
import { DAMAGE_FAMILIES, damageFamily, damageStyle, damageTextSpans } from '../src/renderer/src/damage-types.ts'
import { CAIRN_THEME_MANIFEST, CAIRN_THEME_TOKENS, DAMAGE_TEXT_SURFACES, contrastRatio, resolveThemeManifest } from '../src/renderer/src/semantic-tokens.ts'

for (const family of DAMAGE_FAMILIES) {
  for (const alias of family.aliases) {
    assert.equal(damageFamily(` ${alias.toUpperCase()} `), family.id)
    for (const text of [`${alias} Damage`, `+25% ${alias} Resistance`, `${alias} Retaliation`, `25% ${alias}`]) {
      const spans = damageTextSpans(text)
      assert.equal(spans.map(span => span.text).join(''), text, 'formatting preserves every character')
      assert.deepEqual(spans.filter(span => span.family).map(span => span.family), [family.id], text)
    }
  }
  assert.equal(damageStyle(family.id).color, `var(--gd-damage-${family.id})`)
  for (const surface of DAMAGE_TEXT_SURFACES) {
    assert.ok(contrastRatio(family.color, CAIRN_THEME_TOKENS[surface]) >= 4.5, `${family.id} on ${surface}`)
    const collision = resolveThemeManifest({ ...CAIRN_THEME_MANIFEST, tokens: { [surface]: family.color } })
    assert.equal(collision.fallback, 'cairn')
    assert.ok(collision.issues.some(issue => issue.token === `--gd-damage-${family.id}`), `${surface} must protect ${family.id}`)
  }
}
for (const text of ['+2 to Fire Strike', 'Cold One', 'Aether Ray', 'Burning brightly in the cold', 'Energy Burn', 'Energy Burn Damage', 'of Attack Damage converted to Health', 'Physicality', 'Chaosborne', '<script>cold</script>']) {
  assert.deepEqual(damageTextSpans(text), [{ text }], `Do not color non-damage text: ${text}`)
}
assert.equal(damageFamily('life leech'), undefined)
assert.equal(damageStyle('unknown'), undefined)
const conversion = 'Skill: 40% Physical Damage converted to Vitality Decay Damage; Global: 25% Fire converted to Cold'
assert.equal(damageTextSpans(conversion).map(span => span.text).join(''), conversion)
assert.deepEqual(damageTextSpans(conversion).filter(span => span.family), [
  { text: 'Physical', family: 'physical', conversionRole: 'source' },
  { text: 'Vitality Decay', family: 'vitality', conversionRole: 'target' },
  { text: 'Fire', family: 'fire', conversionRole: 'source' },
  { text: 'Cold', family: 'cold', conversionRole: 'target' }
])
assert.deepEqual(damageTextSpans('Fire, Cold, Vitality Decay', true).filter(span => span.family).map(span => span.family), ['fire', 'cold', 'vitality'])
assert.deepEqual(damageTextSpans('Frostburn Damage; Vitality Decay Damage; Internal Trauma Damage').filter(span => span.family).map(span => span.text), ['Frostburn', 'Vitality Decay', 'Internal Trauma'])
assert.equal(resolveThemeManifest(CAIRN_THEME_MANIFEST).fallback, 'none')
assert.equal(resolveThemeManifest({ ...CAIRN_THEME_MANIFEST, tokens: { '--cc-accent': '#79c2ff' } }).fallback, 'none')
const override = resolveThemeManifest({ ...CAIRN_THEME_MANIFEST, tokens: { '--gd-damage-fire': '#ffffff' } })
assert.equal(override.fallback, 'partial')
assert.equal(override.issues[0].code, 'unknown-token')
console.log('Damage types passed: Rainbow aliases, DOT overlap, conversions, non-damage text, original wording, protected themes and 160 contrast pairs.')
