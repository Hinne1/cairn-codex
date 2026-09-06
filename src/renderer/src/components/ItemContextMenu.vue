<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { itemMenuPosition, type ItemContextAction, type ItemContextActionId, type ItemContextRequest } from '../item-context-menu'
import type { ItemMenuDismissal } from '../use-item-context-menu'

const props = defineProps<{ request: ItemContextRequest<unknown>; name: string; actions: readonly ItemContextAction[] }>()
const emit = defineEmits<{ action: [id: ItemContextActionId]; dismiss: [reason: ItemMenuDismissal] }>()
const menu = ref<HTMLElement | null>(null)
const position = ref({ left: 8, top: 8 })
let disposed = false
const controls = () => [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]

function handleKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); emit('dismiss', 'escape'); return }
  if (event.key === 'Tab') { emit('dismiss', 'tab'); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = controls()
  const index = buttons.findIndex(button => button === document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

function outside(event: PointerEvent): void {
  if (!menu.value?.contains(event.target as Node | null)) emit('dismiss', 'outside')
}
function viewportChanged(event: Event): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return
  emit('dismiss', 'viewport')
}
onMounted(async () => {
  await nextTick()
  if (disposed || !menu.value) return
  const anchor = props.request.source.getBoundingClientRect()
  const rect = menu.value.getBoundingClientRect()
  position.value = itemMenuPosition(props.request.point ?? { x: anchor.left, y: anchor.bottom }, rect, { width: innerWidth, height: innerHeight })
  await nextTick()
  if (disposed || !menu.value) return
  controls()[0]?.focus({ preventScroll: true })
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', viewportChanged)
  window.addEventListener('scroll', viewportChanged, true)
})
onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', viewportChanged)
  window.removeEventListener('scroll', viewportChanged, true)
})
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="item-context-menu" role="menu" :aria-label="`Actions for ${name}`"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }" @keydown="handleKeydown" @contextmenu.prevent>
      <div class="item-context-heading" role="presentation" aria-hidden="true">{{ name }}</div>
      <button v-for="action in actions" :key="action.id" type="button" role="menuitem" tabindex="-1"
        :data-item-action="action.id" @click="emit('action', action.id)">
        <span>{{ action.label }}</span><small v-if="action.description">{{ action.description }}</small>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.item-context-menu { position: fixed; z-index: 150; box-sizing: border-box; width: min(288px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow-y: auto; padding: var(--cc-space-2); border: 1px solid var(--cc-border-strong); border-radius: var(--cc-radius-md); background: var(--cc-surface-1); color: var(--cc-text-primary); box-shadow: var(--cc-shadow-popover); font-family: var(--cc-font-interface); }
.item-context-heading { padding: var(--cc-space-3); border-bottom: 1px solid var(--cc-border-default); color: var(--cc-text-muted); font-size: var(--cc-font-size-sm); overflow-wrap: anywhere; }
button { display: grid; width: 100%; min-height: var(--cc-control-height); gap: var(--cc-space-1); padding: var(--cc-space-3); border: 1px solid transparent; border-radius: var(--cc-radius-sm); background: transparent; color: inherit; font: inherit; font-size: var(--cc-font-size-md); text-align: left; cursor: pointer; }
button:hover, button:focus-visible { border-color: var(--cc-focus); background: var(--cc-accent-surface); outline: none; }
small { color: var(--cc-text-muted); font-size: var(--cc-font-size-xs); }
</style>
