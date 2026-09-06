import { createApp, h, nextTick, ref } from 'vue'
import PresentationLine from '../../src/renderer/src/components/PresentationLine.vue'
import ResearchItemTable from '../../src/renderer/src/components/ResearchItemTable.vue'
import PlannerJourney from '../../src/renderer/src/components/PlannerJourney.vue'
import Glossary from '../../src/renderer/src/workspaces/GlossaryWorkspace.vue'
import { DAMAGE_FAMILIES } from '../../src/renderer/src/damage-types'
import { CAIRN_THEME_MANIFEST, applyThemeManifest } from '../../src/renderer/src/semantic-tokens'
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
  available: index % 2 === 0, itemType: 'Sword', supports: [{ text: '+2 Fire Strike' }],
  modifiers: [
    { kind: 'conversion', label: 'Converts to', targetDamageType: 'Fire', text: 'Fire' },
    { kind: 'conversion', label: 'Conversion', text: '50% Physical Damage converted to Fire Damage' },
    { kind: 'special', label: 'Bonus', text: '25% Vitality Decay; 20% Aether Damage' }
  ], acquisition: [{ text: 'Synthetic source' }], archive: [{ text: '1 copy' }]
})
const view = ref('tooltip')
const rows = ref([makeRow(0), makeRow(1)])
const page = ref(1)
window.damageFixture = {
  view, lines, original: lines.map(formatPresentationLine),
  setCount(count) { page.value = 1; rows.value = Array.from({ length: count }, (_, index) => makeRow(index)) },
  theme(alternate) { applyThemeManifest(document.documentElement, { ...CAIRN_THEME_MANIFEST, tokens: alternate ? { '--cc-accent': '#79c2ff' } : {} }) },
  settle: nextTick
}
createApp({ render: () => h('main', { style: 'padding:16px;min-width:0' }, [
  view.value === 'tooltip' ? h('section', { class: 'game-tooltip legendary tooltip-section', style: 'position:static;max-width:100%;width:460px;max-height:none' }, [
    h('h4', 'Synthetic damage stats'), ...lines.map((stat, index) => h('p', { 'data-line': index }, [h(PresentationLine, { line: stat })]))
  ]) : view.value === 'glossary' ? h(Glossary, { entryId: 'item-rolls' })
    : h(view.value === 'journey' ? PlannerJourney : ResearchItemTable, {
      rows: rows.value, page: page.value, 'onUpdate:page': value => page.value = value,
      iconUrlForItem: () => null, label: 'Synthetic damage research', emptyTitle: 'No synthetic items', emptyDetail: 'Choose a fixture.'
    })
]) }).mount('#app')
