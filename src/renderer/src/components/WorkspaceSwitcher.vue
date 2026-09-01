<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

interface WorkspaceDestination {
  id: string
  label: string
}

const props = defineProps<{
  activeId: string
  tools: WorkspaceDestination[]
}>()

const emit = defineEmits<{
  home: []
  select: [id: string]
  customize: []
}>()

const toolRail = ref<HTMLElement | null>(null)

watch(
  () => props.activeId,
  async () => {
    await nextTick()
    toolRail.value
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  },
  { immediate: true }
)
</script>

<template>
  <nav class="workspace-switcher" aria-label="Specialist workspace navigation">
    <button type="button" class="workspace-home" @click="emit('home')">
      <span aria-hidden="true">←</span>
      <span><small>Collection</small><strong>Dashboard</strong></span>
    </button>
    <div ref="toolRail" class="workspace-tool-rail">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        :class="{ active: tool.id === activeId }"
        :aria-current="tool.id === activeId ? 'page' : undefined"
        @click="emit('select', tool.id)"
      >{{ tool.label }}</button>
    </div>
    <button
      type="button"
      class="workspace-customize"
      aria-label="Customize visible tools"
      title="Customize visible tools"
      @click="emit('customize')"
    >⚙</button>
  </nav>
</template>

<style scoped>
.workspace-switcher {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: stretch;
  gap: var(--cc-space-2);
  margin-bottom: var(--cc-space-5);
  padding: var(--cc-space-2);
  border: 1px solid var(--cc-border-default);
  border-radius: var(--cc-radius-md);
  background: color-mix(in srgb, var(--cc-surface-1), transparent 12%);
}

button {
  min-height: var(--cc-control-height-sm);
  border: 1px solid transparent;
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-muted);
  background: transparent;
  cursor: pointer;
}

button:hover { color: var(--cc-text-primary); background: var(--cc-surface-2); }
button:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 1px; }

.workspace-home {
  display: flex;
  align-items: center;
  gap: var(--cc-space-3);
  padding: var(--cc-space-2) var(--cc-space-4);
  border-color: var(--cc-border-subtle);
  text-align: left;
}

.workspace-home > span:first-child { color: var(--cc-accent); font-size: var(--cc-font-size-xl); }
.workspace-home > span:last-child { display: grid; gap: 1px; }
.workspace-home small { color: var(--cc-text-subtle); font-size: var(--cc-font-size-xs); letter-spacing: .12em; text-transform: uppercase; }
.workspace-home strong { color: var(--cc-text-primary); font-size: var(--cc-font-size-sm); font-weight: 600; }

.workspace-tool-rail {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  gap: var(--cc-space-1);
  scrollbar-width: thin;
  scrollbar-color: var(--cc-border-emphasis) transparent;
}

.workspace-tool-rail button {
  flex: 0 0 auto;
  padding: 0 var(--cc-space-4);
  white-space: nowrap;
}

.workspace-tool-rail button.active {
  border-color: var(--cc-accent-border);
  color: var(--cc-accent-strong);
  background: var(--cc-accent-surface-hover);
}

.workspace-customize {
  width: var(--cc-control-height-sm);
  padding: 0;
  border-color: var(--cc-border-subtle);
  color: var(--cc-text-secondary);
}

@media (max-width: 520px) {
  .workspace-switcher { gap: var(--cc-space-1); padding: var(--cc-space-1); }
  .workspace-home { gap: var(--cc-space-2); padding-inline: var(--cc-space-3); }
  .workspace-home small { display: none; }
  .workspace-tool-rail button { padding-inline: var(--cc-space-3); }
}
</style>
