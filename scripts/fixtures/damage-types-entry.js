import { createApp, h, nextTick, ref } from 'vue'
import PresentationLine from '../../src/renderer/src/components/PresentationLine.vue'
import ResearchItemTable from '../../src/renderer/src/components/ResearchItemTable.vue'
import PlannerJourney from '../../src/renderer/src/components/PlannerJourney.vue'
import Glossary from '../../src/renderer/src/workspaces/GlossaryWorkspace.vue'
import SupplyEffects from '../../src/renderer/src/components/SupplyEffects.vue'
import { buildSupplyCatalogIndex } from '../../src/shared/supply-presentation'
import { DAMAGE_FAMILIES } from '../../src/renderer/src/damage-types'
import { CAIRN_THEME_MANIFEST, applyThemeManifest, contrastRatio } from '../../src/renderer/src/semantic-tokens'
import { formatPresentationLine } from '../../src/renderer/src/item-presentation'
import '../../src/renderer/src/semantic-tokens.css'
import '../../src/renderer/src/styles.css'

const line = (label, extra = {}) => ({ label, minimum: 10, maximum: 20, unit: '%', tone: 'standard', prefix: '+', suffix: '', ...extra })
const lines = DAMAGE_FAMILIES.map(family => line(`${family.aliases.at(-1)} Damage`))
lines.push(line('Physical Damage converted to Fire Damage'), line('Vitality Decay'),
  line('to Fire Strike', { tone: 'skill' }), line('Energy Burn Damage'),
  line('Fire Damage', { suffix: ' to Cold One' }), line('Aether Ray', { tone: 'visual' }))
const makeRow = index => ({
  item: { record: `synthetic/${index}`, name: `Synthetic Fire Strike ${index}`, slot: 'weapon', itemClass: 'WeaponMelee_Sword', levelRequirement: 50, rarity: 'legendary' },
  available: index % 2 === 0, ignored: index % 2 !== 0, itemType: 'Sword', supports: [{ text: '+2 Fire Strike' }],
  modifiers: [
    { kind: 'conversion', label: 'Converts to', targetDamageType: 'Fire', text: 'Fire' },
    { kind: 'conversion', label: 'Conversion', text: '50% Physical Damage converted to Fire Damage' },
    { kind: 'special', label: 'Bonus', text: '25% Vitality Decay; 20% Aether Damage' }
  ], acquisition: [{ text: 'Synthetic source' }], archive: [{ text: '1 copy' }]
})
const view = ref('tooltip')
const supplyItem = { ...makeRow(0).item, presentation: {
  flavorText: 'Fire Damage echoes in this legend.',
  sections: [{ kind: 'base', lines: [line('Fire Damage')] }, { kind: 'pet', lines: [line('Cold Damage', { tone: 'pet' })] }],
  grantedSkill: { name: 'Cold Damage', trigger: null, lines: [line('Aether Damage')] }
} }
const supply = buildSupplyCatalogIndex([supplyItem]).get(supplyItem.record)
const rows = ref([makeRow(0), makeRow(1)])
const page = ref(1)
window.damageFixture = {
  view, lines, original: lines.map(formatPresentationLine), supply,
  referenceContrasts() {
    const hex = rgb => '#' + rgb.match(/[\d.]+/g).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')
    const gradient = getComputedStyle(document.querySelector('.copy-card.reference')).backgroundImage
    const backgrounds = gradient.match(/rgb\([^)]+\)/g).map(hex)
    return Array.from(document.querySelectorAll('.copy-card.reference [data-damage-family]')).flatMap(node =>
      backgrounds.map(background => contrastRatio(hex(getComputedStyle(node).color), background)))
  },
  setCount(count) { page.value = 1; rows.value = Array.from({ length: count }, (_, index) => makeRow(index)) },
  theme(alternate) { applyThemeManifest(document.documentElement, { ...CAIRN_THEME_MANIFEST, tokens: alternate ? { '--cc-accent': '#79c2ff' } : {} }) },
  settle: nextTick
}
createApp({ render: () => h('main', { style: 'padding:16px;min-width:0' }, [
  view.value === 'tooltip' ? h('section', { class: 'game-tooltip legendary tooltip-section', style: 'position:static;max-width:100%;width:460px;max-height:none' }, [
    h('h4', 'Synthetic damage stats'), ...lines.map((stat, index) => h('p', { 'data-line': index }, [h(PresentationLine, { line: stat })]))
  ]) : view.value === 'surfaces' ? h('section', [
    h('article', { class: 'copy-card reference' }, DAMAGE_FAMILIES.map(family => h('p', [h(PresentationLine, { line: line(`${family.id} Damage`) })]))),
    h('article', { class: 'supply-card locked' }, [h('span', { class: 'supply-card-copy', style: 'grid-column:1/-1' }, [h(SupplyEffects, { effects: supply.effects, details: supply.effectDetails, total: supply.effects.length })])]),
    h('div', { id: 'legacy-supply' }, [h(SupplyEffects, { effects: ['Fire Damage'], total: 1 })])
  ]) : view.value === 'glossary' ? h(Glossary, { entryId: 'item-rolls' })
    : h(view.value === 'journey' ? PlannerJourney : ResearchItemTable, {
      rows: rows.value, page: page.value, 'onUpdate:page': value => page.value = value,
      iconUrlForItem: () => null, label: 'Synthetic damage research', emptyTitle: 'No synthetic items', emptyDetail: 'Choose a fixture.'
    })
]) }).mount('#app')
