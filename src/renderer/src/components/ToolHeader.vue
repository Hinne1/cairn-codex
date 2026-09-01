<script setup lang="ts">
withDefaults(defineProps<{
  eyebrow: string
  title: string
  description: string
  tone?: 'gold' | 'green' | 'blue' | 'ember'
}>(), {
  tone: 'gold'
})
</script>

<template>
  <header :class="['tool-header', `tone-${tone}`]">
    <div class="tool-header-copy">
      <p class="tool-header-eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
    </div>
    <div v-if="$slots.aside" class="tool-header-aside">
      <slot name="aside" />
    </div>
  </header>
</template>

<style scoped>
.tool-header {
  --tool-header-border: var(--cc-accent-border);
  --tool-header-surface: linear-gradient(145deg, var(--cc-surface-3), var(--cc-surface-1));
  --tool-header-heading: var(--cc-text-strong);
  --tool-header-copy: var(--cc-text-muted);
  --tool-header-accent: var(--cc-accent);
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--cc-space-9);
  padding: var(--cc-space-8);
  border: 1px solid var(--tool-header-border);
  border-radius: var(--cc-radius-lg);
  background: var(--tool-header-surface);
}
.tool-header.tone-green {
  --tool-header-border: var(--cc-tone-green-border);
  --tool-header-surface: linear-gradient(135deg, color-mix(in srgb, var(--cc-tone-green-surface), var(--cc-mix-light) 5%), var(--cc-tone-green-surface));
  --tool-header-heading: var(--cc-tone-green-heading);
  --tool-header-copy: var(--cc-tone-green-muted);
  --tool-header-accent: var(--cc-tone-green-accent);
}
.tool-header.tone-blue {
  --tool-header-border: var(--cc-tone-blue-border);
  --tool-header-surface: linear-gradient(135deg, color-mix(in srgb, var(--cc-tone-blue-surface), var(--cc-mix-light) 5%), var(--cc-tone-blue-surface));
  --tool-header-heading: var(--cc-tone-blue-heading);
  --tool-header-copy: var(--cc-tone-blue-muted);
  --tool-header-accent: var(--cc-tone-blue-accent);
}
.tool-header.tone-ember {
  --tool-header-border: var(--cc-tone-ember-border);
  --tool-header-surface: radial-gradient(circle at 78% 10%, var(--cc-tone-ember-glow), transparent 35%), linear-gradient(145deg, var(--cc-tone-ember-surface), var(--cc-surface-1));
  --tool-header-accent: var(--cc-tone-ember-accent);
  align-items: center;
}
.tool-header-copy { min-width: 0; flex: 1 1 auto; }
.tool-header-eyebrow { margin: 0; color: var(--tool-header-accent) !important; font-size: var(--cc-font-size-xs) !important; font-weight: 650; letter-spacing: .14em; text-transform: uppercase; }
h2 { margin: var(--cc-space-1) 0 var(--cc-space-3); color: var(--tool-header-heading); font: 500 var(--cc-font-size-5xl)/1.08 var(--cc-font-display); }
.tone-ember h2 { max-width: 790px; font-size: clamp(27px, 2.4vw, 40px); }
.tool-header-copy > p:last-child { max-width: 820px; margin: 0; color: var(--tool-header-copy); font-size: var(--cc-font-size-lg); line-height: var(--cc-line-body); }
.tool-header-aside { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 10px; }
.tool-header-aside :deep(strong) { color: var(--tool-header-accent); font: 500 var(--cc-font-size-3xl) var(--cc-font-display); }
.tool-header-aside :deep(small) { max-width: 320px; color: var(--cc-text-subtle); font-size: var(--cc-font-size-sm); }
.tool-header-aside :deep(button) { min-height: var(--cc-control-height); padding: 0 var(--cc-space-5); border: 1px solid var(--cc-accent-border); border-radius: var(--cc-radius-sm); color: var(--cc-accent-soft); background: var(--cc-accent-surface); cursor: pointer; }
.tool-header-aside :deep(button:hover:not(:disabled)) { border-color: var(--tool-header-accent); background: var(--cc-accent-surface-hover); }
.tool-header-aside :deep(button:focus-visible) { outline: 2px solid var(--tool-header-accent); outline-offset: 1px; }
.tool-header-aside :deep(button:disabled) { opacity: .4; cursor: default; }

@media (max-width: 760px) {
  .tool-header { align-items: stretch; flex-direction: column; }
  .tool-header-aside { justify-content: flex-start; }
}
</style>
