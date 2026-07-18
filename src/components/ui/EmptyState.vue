<script setup lang="ts">
import Icon from './Icon.vue'
defineProps<{ icon: string; title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
    <span class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
      <Icon :name="icon" :size="24" />
    </span>
    <h3 class="text-base font-semibold text-fg">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-fg-muted">{{ description }}</p>
    <div class="mt-5"><slot /></div>
  </div>
</template>
