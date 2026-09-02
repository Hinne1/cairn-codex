<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CharacterSaveProfile } from '@shared/contracts'
import { useModalDialogFocus } from '../modal-focus'
import type { StoredPlannerProfile } from '../preference-repository'
import {
  plannerSkillsForMasteries,
  type PlannerClassOption,
  type PlannerSetupSource,
  type PlannerSetupSubmission
} from '../planner-setup'

const props = defineProps<{
  profiles: StoredPlannerProfile[]
  characters: CharacterSaveProfile[]
  charactersLoading: boolean
  charactersError: string | null
  classOptions: PlannerClassOption[]
  skillNames: string[]
  skillMasteries?: Record<string, string>
}>()

const emit = defineEmits<{
  cancel: []
  'request-characters': []
  submit: [submission: PlannerSetupSubmission]
}>()

const STEP_COUNT = 4
const dialog = ref<HTMLElement | null>(null)
const step = ref(0)
const source = ref<PlannerSetupSource>('blank')
const selectedCharacterPath = ref('')
const selectedCloneId = ref(props.profiles[0]?.id ?? '')
const planName = ref('New build')
const selectedClassName = ref(props.classOptions[0]?.className ?? '')
const selectedSkills = ref<string[]>([])
const skillDraft = ref('')
const minimumLevel = ref(1)
const levelCap = ref(100)
const modalFocus = useModalDialogFocus(dialog, { onEscape: () => emit('cancel') })

const selectedClass = computed(() => props.classOptions.find((option) => option.className === selectedClassName.value) ?? null)
const selectedCharacter = computed(() => props.characters.find((character) => character.path === selectedCharacterPath.value) ?? null)
const selectedClone = computed(() => props.profiles.find((profile) => profile.id === selectedCloneId.value) ?? null)
const recommendedSkills = computed(() => plannerSkillsForMasteries(
  props.skillNames,
  props.skillMasteries,
  selectedClass.value?.masteries ?? []
).filter((skill) => !selectedSkills.value.includes(skill)))
const visibleSkillOptions = computed(() => {
  const query = skillDraft.value.trim().toLocaleLowerCase()
  const sourceSkills = query
    ? props.skillNames.filter((skill) => skill.toLocaleLowerCase().includes(query))
    : recommendedSkills.value
  return sourceSkills.filter((skill) => !selectedSkills.value.includes(skill)).slice(0, 12)
})
const canContinue = computed(() => {
  if (step.value === 0) {
    if (source.value === 'character') return Boolean(selectedCharacter.value && !selectedCharacter.value.error)
    if (source.value === 'clone') return Boolean(selectedClone.value)
    return true
  }
  if (step.value === 1) return Boolean(planName.value.trim() && selectedClassName.value)
  if (step.value === 2) return selectedSkills.value.length > 0
  return minimumLevel.value >= 1 && levelCap.value >= minimumLevel.value && levelCap.value <= 100
})

onMounted(() => {
  document.body.classList.add('planner-setup-active')
  modalFocus.activate()
})
// Body state is presentation-only; focus restoration is owned by the shared modal controller.
onBeforeUnmount(() => document.body.classList.remove('planner-setup-active'))

watch(() => props.characters, (characters) => {
  if (source.value === 'character' && !selectedCharacterPath.value) {
    const first = characters.find((character) => !character.error)
    if (first) selectCharacter(first.path)
  }
})

watch(() => props.classOptions, (options) => {
  if (!selectedClassName.value && options[0]) selectedClassName.value = options[0].className
})

function optionForClassName(className: string | undefined): PlannerClassOption | null {
  if (!className) return null
  return props.classOptions.find((option) => option.className.localeCompare(className, undefined, { sensitivity: 'base' }) === 0) ?? null
}

function validCharacterSkills(character: CharacterSaveProfile): string[] {
  const names = new Map(props.skillNames.map((skill) => [skill.toLocaleLowerCase(), skill]))
  return [...new Set(character.skills.map((skill) => names.get(skill.name.toLocaleLowerCase())).filter((skill): skill is string => Boolean(skill)))]
}

function chooseSource(nextSource: PlannerSetupSource): void {
  source.value = nextSource
  if (nextSource === 'blank') {
    planName.value = 'New build'
    selectedClassName.value = props.classOptions[0]?.className ?? ''
    selectedSkills.value = []
    minimumLevel.value = 1
    levelCap.value = 100
  } else if (nextSource === 'character') {
    emit('request-characters')
    const first = props.characters.find((character) => !character.error)
    if (first) selectCharacter(first.path)
  } else {
    const profile = selectedClone.value ?? props.profiles[0]
    if (profile) selectClone(profile.id)
  }
}

function selectCharacter(path: string): void {
  selectedCharacterPath.value = path
  const character = props.characters.find((candidate) => candidate.path === path)
  if (!character) return
  const classOption = optionForClassName(character.className)
  planName.value = character.name
  selectedClassName.value = classOption?.className ?? props.classOptions[0]?.className ?? ''
  selectedSkills.value = validCharacterSkills(character)
  minimumLevel.value = character.level
  levelCap.value = Math.max(70, character.level)
}

function selectClone(profileId: string): void {
  selectedCloneId.value = profileId
  const profile = props.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) return
  planName.value = `${profile.name} copy`.slice(0, 60)
  selectedClassName.value = optionForClassName(profile.className)?.className ?? props.classOptions[0]?.className ?? ''
  selectedSkills.value = [...profile.skills]
  minimumLevel.value = profile.minimumLevel
  levelCap.value = profile.levelCap
}

function addSkill(skill: string): void {
  const exact = props.skillNames.find((candidate) => candidate.localeCompare(skill.trim(), undefined, { sensitivity: 'base' }) === 0)
    ?? visibleSkillOptions.value[0]
  if (!exact || selectedSkills.value.includes(exact)) return
  selectedSkills.value = [...selectedSkills.value, exact]
  skillDraft.value = ''
}

function removeSkill(skill: string): void {
  selectedSkills.value = selectedSkills.value.filter((candidate) => candidate !== skill)
}

function move(next: number): void {
  if (next > step.value && !canContinue.value) return
  step.value = Math.max(0, Math.min(STEP_COUNT - 1, next))
  void nextTick(() => dialog.value?.focus())
}

function finish(): void {
  if (!canContinue.value || !selectedClass.value) return
  emit('submit', {
    source: source.value,
    name: planName.value.trim(),
    className: selectedClass.value.className,
    masteries: [...selectedClass.value.masteries],
    skills: [...selectedSkills.value],
    minimumLevel: Math.max(1, Math.min(100, Math.round(minimumLevel.value))),
    levelCap: Math.max(minimumLevel.value, Math.min(100, Math.round(levelCap.value))),
    ...(source.value === 'character' ? { characterPath: selectedCharacterPath.value } : {}),
    ...(source.value === 'clone' ? { cloneProfileId: selectedCloneId.value } : {})
  })
}

function handleKeydown(event: KeyboardEvent): void {
  modalFocus.handleKeydown(event)
}
</script>

<template>
  <div class="planner-setup-backdrop">
    <section
      ref="dialog"
      class="planner-setup-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="planner-setup-title"
      @keydown="handleKeydown"
    >
      <header>
        <div>
          <p class="section-label">New plan · {{ step + 1 }} / {{ STEP_COUNT }}</p>
          <h2 id="planner-setup-title">Build a leveling plan</h2>
          <p>Choose a starting point, name the build, add its defining skills, then set the useful item-level window.</p>
        </div>
        <button type="button" class="planner-setup-close" aria-label="Close new plan dialog" @click="emit('cancel')">×</button>
      </header>

      <ol class="planner-setup-progress" aria-label="New plan progress">
        <li v-for="index in STEP_COUNT" :key="index" :class="{ active: step === index - 1, done: step > index - 1 }"><span>{{ index }}</span></li>
      </ol>

      <div v-if="step === 0" class="planner-setup-page">
        <p class="section-label">Starting point</p>
        <h3>How should this plan begin?</h3>
        <div class="planner-source-grid" role="radiogroup" aria-label="Plan starting point">
          <button type="button" role="radio" :aria-checked="source === 'blank'" :class="{ selected: source === 'blank' }" @click="chooseSource('blank')">
            <strong>Blank</strong><span>Start with no skills and shape a build from scratch.</span>
          </button>
          <button type="button" role="radio" :aria-checked="source === 'character'" :class="{ selected: source === 'character' }" @click="chooseSource('character')">
            <strong>Character save</strong><span>Read a local or Steam Cloud character without modifying it.</span>
          </button>
          <button type="button" role="radio" :aria-checked="source === 'clone'" :class="{ selected: source === 'clone' }" @click="chooseSource('clone')">
            <strong>Clone</strong><span>Copy an existing plan and experiment independently.</span>
          </button>
        </div>
        <label v-if="source === 'character'" class="planner-setup-field">
          <span>Character</span>
          <select :value="selectedCharacterPath" :disabled="charactersLoading" @change="selectCharacter(($event.target as HTMLSelectElement).value)">
            <option value="">Choose a readable character…</option>
            <option v-for="character in characters" :key="character.path" :value="character.path" :disabled="Boolean(character.error)">
              {{ character.name }} · {{ character.className || 'Unknown class' }} · Lv{{ character.level }}{{ character.isHardcore ? ' · HC' : '' }}
            </option>
          </select>
          <small v-if="charactersLoading">Reading and validating character saves…</small>
          <small v-else-if="charactersError" class="planner-setup-error">{{ charactersError }}</small>
          <small v-else-if="characters.length === 0">No character saves were found.</small>
        </label>
        <label v-if="source === 'clone'" class="planner-setup-field">
          <span>Plan to clone</span>
          <select :value="selectedCloneId" @change="selectClone(($event.target as HTMLSelectElement).value)">
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}{{ profile.className ? ` · ${profile.className}` : '' }}</option>
          </select>
        </label>
      </div>

      <div v-else-if="step === 1" class="planner-setup-page">
        <p class="section-label">Build identity</p>
        <h3>Name it and choose the combined mastery.</h3>
        <div class="planner-identity-grid">
          <label class="planner-setup-field"><span>Plan name</span><input v-model="planName" maxlength="60" type="text" /></label>
          <label class="planner-setup-field">
            <span>Combined mastery</span>
            <select v-model="selectedClassName" :disabled="classOptions.length === 0">
              <option v-for="option in classOptions" :key="option.className" :value="option.className">{{ option.className }} · {{ option.masteries.join(' + ') }}</option>
            </select>
            <small v-if="classOptions.length === 0" class="planner-setup-error">Combined mastery data is still being indexed. Close this dialog and try again when the collection refresh finishes.</small>
          </label>
        </div>
        <div v-if="selectedClass" class="planner-class-summary"><strong>{{ selectedClass.className }}</strong><span>{{ selectedClass.masteries.join(' + ') }}</span></div>
      </div>

      <div v-else-if="step === 2" class="planner-setup-page">
        <p class="section-label">Build-defining skills</p>
        <h3>Add the skills this character actually uses.</h3>
        <div class="planner-setup-skill-add">
          <input v-model="skillDraft" type="search" placeholder="Search a skill…" @keydown.enter.prevent="addSkill(skillDraft)" />
          <button type="button" :disabled="visibleSkillOptions.length === 0" @click="addSkill(skillDraft)">Add</button>
        </div>
        <div class="planner-setup-suggestions">
          <small>{{ skillDraft ? 'Matching skills' : `Suggested for ${selectedClassName}` }}</small>
          <button v-for="skill in visibleSkillOptions" :key="skill" type="button" @click="addSkill(skill)">+ {{ skill }}</button>
        </div>
        <div class="planner-setup-selected-skills" aria-label="Selected build skills">
          <button v-for="skill in selectedSkills" :key="skill" type="button" :aria-label="`Remove ${skill}`" @click="removeSkill(skill)">{{ skill }} <span>×</span></button>
          <p v-if="selectedSkills.length === 0">Choose at least one build-defining skill to continue.</p>
        </div>
      </div>

      <div v-else class="planner-setup-page">
        <p class="section-label">Level range</p>
        <h3>Which item tiers should CC recommend?</h3>
        <div class="planner-level-setup-grid">
          <label class="planner-setup-field"><span>Minimum item level</span><input v-model.number="minimumLevel" type="number" min="1" :max="levelCap" /></label>
          <label class="planner-setup-field"><span>Level cap</span><input v-model.number="levelCap" type="number" :min="minimumLevel" max="100" /></label>
        </div>
        <div class="planner-setup-review">
          <span><small>Plan</small><strong>{{ planName }}</strong></span>
          <span><small>Class</small><strong>{{ selectedClassName }}</strong></span>
          <span><small>Skills</small><strong>{{ selectedSkills.length }}</strong></span>
          <span><small>Range</small><strong>Lv{{ minimumLevel }}–{{ levelCap }}</strong></span>
        </div>
      </div>

      <footer>
        <button type="button" class="secondary" @click="emit('cancel')">Cancel</button>
        <span />
        <button v-if="step > 0" type="button" class="secondary" @click="move(step - 1)">Back</button>
        <button v-if="step < STEP_COUNT - 1" type="button" :disabled="!canContinue" @click="move(step + 1)">Continue</button>
        <button v-else type="button" :disabled="!canContinue" @click="finish">Create plan</button>
      </footer>
    </section>
  </div>
</template>
