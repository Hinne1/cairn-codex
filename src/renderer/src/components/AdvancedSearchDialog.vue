<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import {
  buildAdvancedSearchQuery,
  newAdvancedSearchRule,
  operatorsForField,
  parseAdvancedSearchDraft,
  type AdvancedSearchDraft,
  type AdvancedSearchOperator,
  type AdvancedSearchRule
} from '@shared/advanced-search'
import type { SearchFieldDefinition, SearchWorkspaceSchema } from '@shared/search-schema'

const props = defineProps<{
  modelValue: string
  searchLabel: string
  schema: SearchWorkspaceSchema
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const firstControl = ref<HTMLSelectElement | null>(null)
const draft = ref<AdvancedSearchDraft>({ combinator: 'all', rules: [newAdvancedSearchRule()], preservedQuery: '' })
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const errorRuleId = ref<number | null>(null)
const dialogId = `advanced-search-${useId()}`
const errorId = `${dialogId}-error`

const preview = computed(() => buildAdvancedSearchQuery(draft.value, props.schema))
const searchSubject = computed(() => props.searchLabel.replace(/^Search\s+/iu, '').trim().toLocaleLowerCase())

watch(draft, () => {
  error.value = null
  errorRuleId.value = null
}, { deep: true })

const operatorLabels: Record<AdvancedSearchOperator, string> = {
  contains: 'contains',
  exact: 'exact phrase',
  is: 'is',
  'is-not': 'is not',
  'at-least': 'at least',
  'at-most': 'at most',
  'greater-than': 'more than',
  'less-than': 'less than'
}

function fieldDefinition(rule: AdvancedSearchRule): SearchFieldDefinition | null {
  return props.schema.fields.find((field) => field.name === rule.field) ?? null
}

function ruleOperators(rule: AdvancedSearchRule): readonly AdvancedSearchOperator[] {
  return operatorsForField(fieldDefinition(rule))
}

function valuePlaceholder(rule: AdvancedSearchRule): string {
  const field = fieldDefinition(rule)
  if (field?.kind === 'number') return 'Enter a number'
  if (field?.values?.length) return `Choose or type ${field.label.toLocaleLowerCase()}`
  return rule.field ? `Enter ${field?.label.toLocaleLowerCase() ?? 'a value'}` : 'Words or a phrase'
}

function openDialog(): void {
  const parsed = parseAdvancedSearchDraft(props.modelValue, props.schema)
  draft.value = parsed.draft
  notice.value = parsed.notice
  error.value = null
  errorRuleId.value = null
  dialog.value?.showModal()
  void nextTick(() => firstControl.value?.focus())
}

function closeDialog(): void {
  dialog.value?.close()
  void nextTick(() => trigger.value?.focus())
}

function resetDraft(): void {
  draft.value = { combinator: 'all', rules: [newAdvancedSearchRule()], preservedQuery: '' }
  notice.value = null
  error.value = null
  errorRuleId.value = null
  void nextTick(() => firstControl.value?.focus())
}

function addRule(): void {
  draft.value.rules.push(newAdvancedSearchRule())
  error.value = null
}

function removeRule(index: number): void {
  draft.value.rules.splice(index, 1)
  if (draft.value.rules.length === 0) draft.value.rules.push(newAdvancedSearchRule())
}

function updateField(rule: AdvancedSearchRule): void {
  const operators = ruleOperators(rule)
  if (!operators.includes(rule.operator)) rule.operator = operators[0]!
  error.value = null
}

function updateOperator(rule: AdvancedSearchRule): void {
  if (rule.operator === 'is-not') rule.negated = false
}

function apply(): void {
  const built = buildAdvancedSearchQuery(draft.value, props.schema)
  if (built.error) {
    error.value = built.error
    errorRuleId.value = built.errorRuleId
    return
  }
  emit('update:modelValue', built.query)
  closeDialog()
}

function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])')]
    .filter((control) => control.offsetParent !== null)
  if (!controls.length) return
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="advanced-search-trigger"
    :aria-haspopup="'dialog'"
    :aria-controls="dialogId"
    @click="openDialog"
  >Advanced search</button>

  <Teleport to="body">
    <dialog
      :id="dialogId"
      ref="dialog"
      class="advanced-search-dialog"
      :aria-labelledby="`${dialogId}-title`"
      :aria-describedby="`${dialogId}-description`"
      @cancel.prevent="closeDialog"
      @keydown="trapFocus"
    >
      <form method="dialog" @submit.prevent="apply">
        <header>
          <div>
            <span>Visual query builder</span>
            <h2 :id="`${dialogId}-title`">Advanced search: {{ searchSubject }}</h2>
            <p :id="`${dialogId}-description`">Build a query here, then keep editing the same text in the normal search box.</p>
          </div>
          <button type="button" class="advanced-search-close" aria-label="Close advanced search" @click="closeDialog">×</button>
        </header>

        <section v-if="draft.preservedQuery" class="advanced-search-preserved" aria-live="polite">
          <strong>Preserved query</strong>
          <code>{{ draft.preservedQuery }}</code>
          <p>{{ notice }}</p>
        </section>

        <fieldset class="advanced-search-combinator">
          <legend>Match</legend>
          <label><input v-model="draft.combinator" type="radio" value="all" /> All of these rules</label>
          <label><input v-model="draft.combinator" type="radio" value="any" /> Any of these rules</label>
        </fieldset>

        <div class="advanced-search-rules">
          <div v-for="(rule, index) in draft.rules" :key="rule.id" class="advanced-search-rule">
            <span class="advanced-search-rule-number" aria-hidden="true">{{ index + 1 }}</span>
            <label>
              <span>Field</span>
              <select
                :ref="(element) => { if (index === 0) firstControl = element as HTMLSelectElement }"
                v-model="rule.field"
                :aria-label="`Rule ${index + 1} field`"
                :aria-invalid="errorRuleId === rule.id"
                :aria-describedby="errorRuleId === rule.id ? errorId : undefined"
                @change="updateField(rule)"
              >
                <option value="">Any text</option>
                <option v-for="field in schema.fields" :key="field.name" :value="field.name">{{ field.label }}</option>
              </select>
            </label>
            <label>
              <span>Operator</span>
              <select
                v-model="rule.operator"
                :aria-label="`Rule ${index + 1} operator`"
                :aria-invalid="errorRuleId === rule.id"
                :aria-describedby="errorRuleId === rule.id ? errorId : undefined"
                @change="updateOperator(rule)"
              >
                <option v-for="operator in ruleOperators(rule)" :key="operator" :value="operator">{{ operatorLabels[operator] }}</option>
              </select>
            </label>
            <label class="advanced-search-value">
              <span>Value</span>
              <select
                v-if="fieldDefinition(rule)?.kind === 'boolean'"
                v-model="rule.value"
                :aria-label="`Rule ${index + 1} value`"
                :aria-invalid="errorRuleId === rule.id"
                :aria-describedby="errorRuleId === rule.id ? errorId : undefined"
              >
                <option value="" disabled>Choose…</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              <input
                v-else
                v-model="rule.value"
                :list="fieldDefinition(rule)?.values ? `${dialogId}-values-${rule.id}` : undefined"
                :type="fieldDefinition(rule)?.kind === 'number' ? 'number' : 'text'"
                :step="fieldDefinition(rule)?.kind === 'number' ? 'any' : undefined"
                :placeholder="valuePlaceholder(rule)"
                :aria-label="`Rule ${index + 1} value`"
                :aria-invalid="errorRuleId === rule.id"
                :aria-describedby="errorRuleId === rule.id ? errorId : undefined"
              />
              <datalist v-if="fieldDefinition(rule)?.values" :id="`${dialogId}-values-${rule.id}`">
                <option v-for="value in fieldDefinition(rule)?.values" :key="value" :value="value" />
              </datalist>
            </label>
            <label class="advanced-search-negate">
              <input v-model="rule.negated" type="checkbox" :disabled="rule.operator === 'is-not'" />
              <span>Exclude this rule from the results</span>
            </label>
            <button type="button" class="advanced-search-remove" :aria-label="`Remove rule ${index + 1}`" @click="removeRule(index)">Remove</button>
          </div>
        </div>

        <button type="button" class="advanced-search-add" @click="addRule">+ Add rule</button>

        <section class="advanced-search-preview" aria-live="polite">
          <span>Query preview</span>
          <code>{{ preview.error ? 'Complete every rule to preview the query.' : preview.query || 'All results' }}</code>
        </section>
        <p v-if="error" :id="errorId" class="advanced-search-error" role="alert">{{ error }}</p>

        <footer>
          <button type="button" @click="resetDraft">Reset</button>
          <span />
          <button type="button" @click="closeDialog">Cancel</button>
          <button type="submit" class="advanced-search-apply">Apply search</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.advanced-search-trigger {
  padding: 2px 4px;
  border: 0;
  border-radius: 3px;
  color: #a18e65;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 8px;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.advanced-search-trigger:hover { color: #d3b777; }
.advanced-search-trigger:focus-visible { outline: 1px solid var(--explorer-focus, #8c7040); outline-offset: 2px; }

.advanced-search-dialog {
  width: min(840px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  padding: 0;
  border: 1px solid #554a37;
  border-radius: 10px;
  color: #d8cfbd;
  color-scheme: dark;
  background: #171713;
  box-shadow: 0 24px 70px rgba(0, 0, 0, .68);
  scrollbar-color: #625d53 #171713;
}
.advanced-search-dialog::backdrop { background: rgba(4, 4, 3, .78); backdrop-filter: blur(2px); }
.advanced-search-dialog form { display: grid; max-height: inherit; overflow: auto; gap: 16px; padding: 20px; }
.advanced-search-dialog header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.advanced-search-dialog header span,
.advanced-search-preview > span { color: #8e7a50; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; }
.advanced-search-dialog h2 { margin: 4px 0 6px; color: #ead9b8; font: 500 24px Georgia, serif; }
.advanced-search-dialog header p { max-width: 590px; margin: 0; color: #9f9788; font-size: 11px; line-height: 1.5; }
.advanced-search-close { width: 32px; height: 32px; border: 0; color: #a59a86; background: transparent; cursor: pointer; font-size: 22px; }
.advanced-search-preserved { display: grid; gap: 7px; padding: 12px; border: 1px solid #685235; border-radius: 6px; background: #251f16; }
.advanced-search-preserved strong { color: #d5b878; font-size: 11px; }
.advanced-search-preserved code,
.advanced-search-preview code { overflow-wrap: anywhere; color: #e2d4b9; font: 11px/1.5 Consolas, monospace; }
.advanced-search-preserved p { margin: 0; color: #b8a889; font-size: 10px; line-height: 1.45; }
.advanced-search-combinator { display: flex; align-items: center; gap: 18px; padding: 0; border: 0; }
.advanced-search-combinator legend { float: left; margin-right: 18px; color: #887e6d; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.advanced-search-combinator label { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.advanced-search-rules { display: grid; gap: 8px; }
.advanced-search-rule { display: grid; grid-template-columns: 24px minmax(130px, .75fr) minmax(120px, .65fr) minmax(180px, 1.4fr) auto; align-items: end; gap: 8px; padding: 10px; border: 1px solid #37332b; border-radius: 6px; background: #1d1c18; }
.advanced-search-rule-number { align-self: center; color: #7c705a; font: 14px Georgia, serif; text-align: center; }
.advanced-search-rule label { display: grid; gap: 5px; }
.advanced-search-rule label > span { color: #7f7769; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
.advanced-search-rule select,
.advanced-search-rule input { width: 100%; min-width: 0; height: 36px; padding: 0 9px; border: 1px solid #4b4438; border-radius: 5px; color: #ddd3c0; outline: none; background: #11110f; font: inherit; font-size: 11px; }
.advanced-search-rule select:focus,
.advanced-search-rule input:focus { border-color: #9b7b42; box-shadow: 0 0 0 2px rgba(155, 123, 66, .18); }
.advanced-search-remove,
.advanced-search-add,
.advanced-search-dialog footer button { min-height: 36px; padding: 0 11px; border: 1px solid #514837; border-radius: 5px; color: #cdbb98; background: #28241d; cursor: pointer; font: 10px inherit; }
.advanced-search-remove { color: #b99689; background: transparent; }
.advanced-search-negate { grid-column: 2 / 5; display: flex !important; align-items: center; gap: 7px !important; color: #a79c89; font-size: 10px; }
.advanced-search-negate input { width: 15px; height: 15px; margin: 0; accent-color: #b58c42; }
.advanced-search-negate input:disabled + span { opacity: .55; }
.advanced-search-add { justify-self: start; }
.advanced-search-preview { display: grid; min-height: 58px; gap: 7px; padding: 11px; border: 1px solid #3f3a31; border-radius: 6px; background: #10100e; }
.advanced-search-error { margin: -8px 0 0; color: #d18c7b; font-size: 10px; }
.advanced-search-dialog footer { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; padding-top: 4px; }
.advanced-search-dialog footer .advanced-search-apply { border-color: #806534; color: #19150e; background: #c39c51; font-weight: 700; }

@media (max-width: 680px) {
  .advanced-search-dialog { width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
  .advanced-search-dialog form { gap: 13px; padding: 14px; }
  .advanced-search-rule { grid-template-columns: 24px 1fr; }
  .advanced-search-rule-number { grid-row: 1 / span 4; }
  .advanced-search-rule label,
  .advanced-search-remove { grid-column: 2; }
  .advanced-search-negate { grid-column: 2; }
  .advanced-search-combinator { align-items: start; flex-direction: column; gap: 9px; }
  .advanced-search-combinator legend { float: none; margin: 0 0 4px; }
  .advanced-search-dialog footer { grid-template-columns: 1fr 1fr; }
  .advanced-search-dialog footer span { display: none; }
}
</style>
