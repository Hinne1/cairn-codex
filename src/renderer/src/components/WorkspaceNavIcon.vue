<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg
    class="workspace-nav-svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'collection'">
      <path d="M4 7h16v13H4z" />
      <path d="m7 7 1.5-3h7L17 7M9 12h6" />
    </template>
    <template v-else-if="name === 'sets'">
      <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
      <path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
    </template>
    <template v-else-if="name === 'materials'">
      <path d="m8 4-4 6 8 10 8-10-4-6z" />
      <path d="m4 10 8 2 8-2M8 4l4 8 4-8" />
    </template>
    <template v-else-if="name === 'skills'">
      <path d="m4 20 10-10M12 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1z" />
      <path d="m17 12 .8-1.7.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8zM5 12l7 7" />
    </template>
    <template v-else-if="name === 'oracle'">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.8" />
    </template>
    <template v-else-if="name === 'planner'">
      <path d="m3.5 6 5-2 7 2 5-2v14l-5 2-7-2-5 2zM8.5 4v14M15.5 6v14" />
      <path d="m11 10 1.5 1.5L14.5 9" />
    </template>
    <template v-else-if="name === 'workshop'">
      <path d="m14 5 5 5M16.5 2.5l5 5-2.5 2.5-5-5zM14.5 9.5 6 18" />
      <path d="m4 16 4 4-2 2-4-4z" />
    </template>
    <template v-else-if="name === 'supplies'">
      <path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 4h9.6a2.5 2.5 0 0 0 2.2-4l-5-9V3" />
      <path d="M7.5 15h9" />
    </template>
    <template v-else-if="name === 'farming'">
      <path d="M18.5 10.5c0 5-6.5 10-6.5 10s-6.5-5-6.5-10a6.5 6.5 0 1 1 13 0z" />
      <path d="M12 13V8.5M12 10.5c-2.2 0-3-1.3-3-2.7 2.2 0 3 1.2 3 2.7zM12 9c1.8 0 2.5-1 2.5-2.2C12.7 6.8 12 7.8 12 9z" />
    </template>
    <template v-else-if="name === 'dismantling'">
      <path d="m8.5 4 2-2 2 2M10.5 2v5M18.5 9l2.7.7-.7 2.7M21.2 9.7l-4.3 2.5M15.5 19l-2 2-2-2M13.5 21v-5M5.5 15l-2.7-.7.7-2.7M2.8 14.3l4.3-2.5" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'trivia'">
      <path d="M8.5 15.5c-1.5-1.1-2.5-2.8-2.5-4.8a6 6 0 1 1 12 0c0 2-1 3.7-2.5 4.8-.8.6-1.1 1.2-1.1 2.2H9.6c0-1-.3-1.6-1.1-2.2zM9.5 21h5M9.6 17.7h4.8" />
    </template>
    <template v-else-if="name === 'todo'">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="m8 9 1.5 1.5L12 8M14 9h3M8 15l1.5 1.5L12 14M14 15h3" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="18" r="2" />
    </template>
    <template v-else-if="name === 'panel-collapse' || name === 'panel-expand'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 3v18" />
      <path v-if="name === 'panel-collapse'" d="m16 9-3 3 3 3" />
      <path v-else d="m13 9 3 3-3 3" />
    </template>
    <circle v-else cx="12" cy="12" r="4" />
  </svg>
</template>

<style scoped>
.workspace-nav-svg { display: block; width: 22px; height: 22px; }
</style>
