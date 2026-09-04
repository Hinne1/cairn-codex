<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkspaceNavIcon from './WorkspaceNavIcon.vue'

interface WorkspaceDestination {
  id: string
  label: string
}

const props = defineProps<{
  activeId: string
  tools: WorkspaceDestination[]
  collapsed: boolean
  toolsEnabled: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  home: []
  transfers: []
  settings: []
  glossary: []
  customize: []
  toggle: []
}>()

const toolIcons: Record<string, string> = {
  sets: 'sets',
  materials: 'materials',
  skills: 'skills',
  oracle: 'oracle',
  planner: 'planner',
  'mi-workshop': 'workshop',
  supplies: 'supplies',
  farming: 'farming',
  dismantling: 'dismantling',
  trivia: 'trivia',
  todo: 'todo'
}

function toolIcon(id: string): string {
  return toolIcons[id] ?? 'fallback'
}

interface TooltipTarget {
  control: HTMLElement
  label: string
}

const tooltip = ref<{ label: string; left: number; top: number } | null>(null)
const hoveredTarget = ref<TooltipTarget | null>(null)
const focusedTarget = ref<TooltipTarget | null>(null)
const compactViewport = window.matchMedia('(max-width: 900px)')

function labelsAreHidden(): boolean {
  return props.collapsed || compactViewport.matches
}

function syncTooltip(): void {
  const target = hoveredTarget.value ?? focusedTarget.value
  if (!target || !labelsAreHidden()) {
    tooltip.value = null
    return
  }
  const rect = target.control.getBoundingClientRect()
  tooltip.value = {
    label: target.control.getAttribute('aria-label') ?? target.label,
    left: rect.right + 10,
    top: Math.min(Math.max(rect.top + rect.height / 2, 20), window.innerHeight - 20)
  }
}

function showTooltip(event: MouseEvent | FocusEvent, label: string, source: 'hover' | 'focus'): void {
  const control = event.currentTarget ?? event.target
  if (!(control instanceof HTMLElement)) return
  const target = { control, label }
  if (source === 'hover') hoveredTarget.value = target
  else focusedTarget.value = target
  syncTooltip()
}

function hideTooltip(event: MouseEvent | FocusEvent, source: 'hover' | 'focus'): void {
  const control = event.currentTarget ?? event.target
  if (source === 'hover' && hoveredTarget.value?.control === control) hoveredTarget.value = null
  if (source === 'focus' && focusedTarget.value?.control === control) focusedTarget.value = null
  syncTooltip()
}

function clearTooltips(): void {
  hoveredTarget.value = null
  focusedTarget.value = null
  tooltip.value = null
}

watch(() => props.collapsed, syncTooltip, { flush: 'post' })
onMounted(() => {
  window.addEventListener('resize', syncTooltip)
  compactViewport.addEventListener('change', syncTooltip)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncTooltip)
  compactViewport.removeEventListener('change', syncTooltip)
  clearTooltips()
})
</script>

<template>
  <aside class="workspace-sidebar" :class="{ collapsed }" aria-label="Application navigation">
    <nav aria-label="Destinations">
      <button
        type="button"
        class="workspace-nav-item workspace-nav-home"
        data-destination-id="collection"
        :aria-current="activeId === 'collection' ? 'page' : undefined"
        aria-label="Collection"
        @mouseenter="showTooltip($event, 'Collection', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, 'Collection', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('home')"
      >
        <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon name="collection" /></span>
        <span class="workspace-nav-label">Collection</span>
      </button>
      <p class="workspace-nav-group-label">Your tools</p>
      <div class="workspace-nav-tools">
        <button
          v-for="tool in props.tools"
          :key="tool.id"
          type="button"
          class="workspace-nav-item"
          :data-tool-id="tool.id"
          :disabled="!toolsEnabled"
          :aria-current="tool.id === activeId ? 'page' : undefined"
          :aria-label="tool.label"
          @mouseenter="showTooltip($event, tool.label, 'hover')"
          @mouseleave="hideTooltip($event, 'hover')"
          @focusin="showTooltip($event, tool.label, 'focus')"
          @blur="hideTooltip($event, 'focus')"
          @click="emit('select', tool.id)"
        >
          <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon :name="toolIcon(tool.id)" /></span>
          <span class="workspace-nav-label">{{ tool.label }}</span>
        </button>
      </div>
    </nav>

    <div class="workspace-sidebar-actions">
      <button
        type="button"
        class="workspace-nav-item"
        data-destination-id="glossary"
        :aria-current="activeId === 'glossary' ? 'page' : undefined"
        aria-label="Glossary"
        @mouseenter="showTooltip($event, 'Glossary', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, 'Glossary', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('glossary')"
      >
        <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon name="glossary" /></span>
        <span class="workspace-nav-label">Glossary</span>
      </button>
      <button
        type="button"
        class="workspace-nav-item"
        data-destination-id="vault"
        :aria-current="activeId === 'vault' ? 'page' : undefined"
        aria-label="Transfers"
        @mouseenter="showTooltip($event, 'Transfers', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, 'Transfers', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('transfers')"
      >
        <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon name="transfers" /></span>
        <span class="workspace-nav-label">Transfers</span>
      </button>
      <button
        type="button"
        class="workspace-nav-item"
        data-destination-id="settings"
        :aria-current="activeId === 'settings' ? 'page' : undefined"
        aria-label="Settings"
        @mouseenter="showTooltip($event, 'Settings', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, 'Settings', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('settings')"
      >
        <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon name="settings" /></span>
        <span class="workspace-nav-label">Settings</span>
      </button>
      <button
        type="button"
        class="workspace-nav-item"
        aria-label="Customize visible tools"
        @mouseenter="showTooltip($event, 'Customize visible tools', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, 'Customize visible tools', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('customize')"
      >
        <span class="workspace-nav-icon" aria-hidden="true"><WorkspaceNavIcon name="settings" /></span>
        <span class="workspace-nav-label">Customize tools</span>
      </button>
      <button
        type="button"
        class="workspace-nav-item workspace-sidebar-toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? 'Expand workspace navigation' : 'Collapse workspace navigation'"
        @mouseenter="showTooltip($event, collapsed ? 'Expand navigation' : 'Collapse navigation', 'hover')"
        @mouseleave="hideTooltip($event, 'hover')"
        @focusin="showTooltip($event, collapsed ? 'Expand navigation' : 'Collapse navigation', 'focus')"
        @blur="hideTooltip($event, 'focus')"
        @click="emit('toggle')"
      >
        <span class="workspace-nav-icon" aria-hidden="true">
          <WorkspaceNavIcon :name="collapsed ? 'panel-expand' : 'panel-collapse'" />
        </span>
        <span class="workspace-nav-label">Collapse</span>
      </button>
    </div>
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="workspace-nav-tooltip"
        role="tooltip"
        :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"
      >{{ tooltip.label }}</div>
    </Teleport>
  </aside>
</template>

<style scoped>
.workspace-sidebar {
  position: sticky;
  z-index: 6;
  top: 92px;
  display: flex;
  width: 244px;
  height: calc(100vh - 92px);
  min-height: 0;
  flex-direction: column;
  justify-content: space-between;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--cc-space-5) var(--cc-space-3) var(--cc-space-4);
  border-right: 1px solid var(--cc-border-subtle);
  background: color-mix(in srgb, var(--cc-canvas-deep), transparent 4%);
  scrollbar-width: thin;
  scrollbar-color: var(--cc-border-emphasis) transparent;
}

.workspace-sidebar.collapsed { width: 68px; }
.workspace-sidebar nav,
.workspace-nav-tools,
.workspace-sidebar-actions { display: grid; gap: var(--cc-space-1); }

.workspace-nav-item {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  width: 100%;
  min-height: 42px;
  align-items: center;
  gap: var(--cc-space-2);
  padding: var(--cc-space-1) var(--cc-space-3);
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-muted);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: color var(--cc-transition-fast), background var(--cc-transition-fast), border-color var(--cc-transition-fast);
}

.workspace-nav-item:hover { color: var(--cc-text-primary); background: var(--cc-surface-2); }
.workspace-nav-item:disabled { color: var(--cc-text-subtle); cursor: default; opacity: .48; }
.workspace-nav-item:disabled:hover { background: transparent; }
.workspace-nav-item:focus-visible { outline: 2px solid var(--cc-focus); outline-offset: 1px; }
.workspace-nav-item[aria-current='page'] {
  border-color: var(--cc-accent-border);
  color: var(--cc-accent-strong);
  background: linear-gradient(90deg, var(--cc-accent-surface-hover), transparent);
}
.workspace-nav-item[aria-current='page']::before {
  content: '';
  position: absolute;
  inset: 6px auto 6px 0;
  width: 2px;
  border-radius: 2px;
  background: var(--cc-accent);
}

.workspace-nav-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: var(--cc-text-primary);
  line-height: 1;
}
.workspace-nav-item[aria-current='page'] .workspace-nav-icon { color: var(--cc-accent-strong); }
.workspace-nav-label {
  min-width: 0;
  overflow: hidden;
  font-size: var(--cc-font-size-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-nav-group-label {
  margin: var(--cc-space-2) var(--cc-space-3);
  color: var(--cc-text-subtle);
  font-size: var(--cc-font-size-xs);
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.workspace-sidebar-actions {
  padding-top: var(--cc-space-4);
  border-top: 1px solid var(--cc-border-subtle);
}
.workspace-sidebar-actions [aria-label='Customize visible tools'] {
  margin-top: var(--cc-space-2);
  border-top: 1px solid var(--cc-border-subtle);
  border-radius: 0 0 var(--cc-radius-sm) var(--cc-radius-sm);
  padding-top: var(--cc-space-2);
}
.workspace-nav-tooltip {
  position: fixed;
  z-index: 120;
  max-width: min(260px, calc(100vw - 96px));
  padding: 7px 10px;
  border: 1px solid var(--cc-border-emphasis);
  border-radius: var(--cc-radius-sm);
  color: var(--cc-text-primary);
  background: var(--cc-surface-overlay);
  box-shadow: var(--cc-shadow-popover);
  font-size: var(--cc-font-size-sm);
  font-weight: 650;
  line-height: 1.25;
  pointer-events: none;
  transform: translateY(-50%);
  white-space: nowrap;
}

.workspace-sidebar.collapsed .workspace-nav-item {
  grid-template-columns: 32px;
  justify-content: center;
  padding-inline: 5px;
}
.workspace-sidebar.collapsed .workspace-nav-label,
.workspace-sidebar.collapsed .workspace-nav-group-label { display: none; }

@media (max-width: 900px) {
  .workspace-sidebar,
  .workspace-sidebar.collapsed {
    width: 60px;
    padding-inline: 7px;
  }
  .workspace-nav-item {
    grid-template-columns: 32px;
    justify-content: center;
    padding-inline: 5px;
  }
  .workspace-nav-label,
  .workspace-nav-group-label { display: none; }
  .workspace-sidebar-toggle { display: none; }
}
</style>
