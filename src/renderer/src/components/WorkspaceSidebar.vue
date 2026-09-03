<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import WorkspaceNavIcon from './WorkspaceNavIcon.vue'

interface WorkspaceDestination {
  id: string
  label: string
}

const props = defineProps<{
  activeId: string
  tools: WorkspaceDestination[]
  collapsed: boolean
}>()

const emit = defineEmits<{
  home: []
  select: [id: string]
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

const tooltip = ref<{ label: string; left: number; top: number } | null>(null)

function labelsAreHidden(): boolean {
  return props.collapsed || window.matchMedia('(max-width: 900px)').matches
}

function showTooltip(event: MouseEvent | FocusEvent, label: string): void {
  const control = event.currentTarget ?? event.target
  if (!(control instanceof HTMLElement)) return
  if (!labelsAreHidden()) return
  const rect = control.getBoundingClientRect()
  tooltip.value = {
    label,
    left: rect.right + 10,
    top: Math.min(Math.max(rect.top + rect.height / 2, 20), window.innerHeight - 20)
  }
}

function hideTooltip(): void {
  tooltip.value = null
}

onMounted(() => window.addEventListener('resize', hideTooltip))
onBeforeUnmount(() => window.removeEventListener('resize', hideTooltip))
</script>

<template>
  <aside class="workspace-sidebar" :class="{ collapsed }" aria-label="Workspace">
    <nav aria-label="Collection and tools">
      <button
        type="button"
        class="workspace-nav-item collection-destination"
        data-tool-id="collection"
        :aria-current="activeId === 'collection' ? 'page' : undefined"
        aria-label="Collection"
        :title="collapsed ? 'Collection' : undefined"
        @mouseenter="showTooltip($event, 'Collection')"
        @mouseleave="hideTooltip"
        @focusin="showTooltip($event, 'Collection')"
        @blur="hideTooltip"
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
          :aria-current="tool.id === activeId ? 'page' : undefined"
          :aria-label="tool.label"
          :title="collapsed ? tool.label : undefined"
          @mouseenter="showTooltip($event, tool.label)"
          @mouseleave="hideTooltip"
          @focusin="showTooltip($event, tool.label)"
          @blur="hideTooltip"
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
        aria-label="Customize visible tools"
        :title="collapsed ? 'Customize visible tools' : undefined"
        @mouseenter="showTooltip($event, 'Customize visible tools')"
        @mouseleave="hideTooltip"
        @focusin="showTooltip($event, 'Customize visible tools')"
        @blur="hideTooltip"
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
        :title="collapsed ? 'Expand navigation' : 'Collapse navigation'"
        @mouseenter="showTooltip($event, collapsed ? 'Expand navigation' : 'Collapse navigation')"
        @mouseleave="hideTooltip"
        @focusin="showTooltip($event, collapsed ? 'Expand navigation' : 'Collapse navigation')"
        @blur="hideTooltip"
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
  margin: var(--cc-space-5) var(--cc-space-3) var(--cc-space-2);
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
