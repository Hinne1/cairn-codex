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
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 28px;
  padding: 24px;
  border: 1px solid #443c2e;
  border-radius: 9px;
  background: linear-gradient(145deg, #24211b, #171714);
}
.tool-header.tone-green { border-color: #3d4c31; background: linear-gradient(135deg, rgba(37,49,31,.94), rgba(24,23,19,.92)); }
.tool-header.tone-blue { border-color: #3b4c54; background: linear-gradient(135deg, rgba(29,40,45,.94), rgba(23,24,22,.92)); }
.tool-header.tone-ember { align-items: center; border-color: #55462c; background: radial-gradient(circle at 78% 10%, rgba(132,91,35,.2), transparent 35%), linear-gradient(145deg, #292319, #151513); }
.tool-header-copy { min-width: 0; flex: 1 1 auto; }
.tool-header-eyebrow { margin: 0; color: #ac9669 !important; font-size: 9px !important; font-weight: 650; letter-spacing: .14em; text-transform: uppercase; }
h2 { margin: 4px 0 8px; color: #eadfc8; font: 500 30px/1.08 Georgia, serif; }
.tone-green h2 { color: #dcebd2; }
.tone-blue h2 { color: #d7e6eb; }
.tone-ember h2 { max-width: 790px; font-size: clamp(27px, 2.4vw, 40px); }
.tool-header-copy > p:last-child { max-width: 820px; margin: 0; color: #8d8575; font-size: 12px; line-height: 1.5; }
.tone-green .tool-header-copy > p:last-child { color: #8d987f; }
.tone-blue .tool-header-copy > p:last-child { color: #82949b; }
.tool-header-aside { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 10px; }
.tool-header-aside :deep(strong) { color: #d3aa55; font: 500 20px Georgia, serif; }
.tool-header-aside :deep(small) { max-width: 320px; color: #827967; font-size: 10px; }
.tool-header-aside :deep(button) { padding: 10px 14px; border: 1px solid #55472f; border-radius: 5px; color: #d5ba7b; background: #2a241b; cursor: pointer; }
.tool-header-aside :deep(button:disabled) { opacity: .4; cursor: default; }

@media (max-width: 760px) {
  .tool-header { align-items: stretch; flex-direction: column; }
  .tool-header-aside { justify-content: flex-start; }
}
</style>
