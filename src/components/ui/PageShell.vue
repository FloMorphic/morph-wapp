<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; icon?: string }>()
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-6xl px-6 py-8">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-fg">{{ title }}</h1>
          <p v-if="subtitle" class="mt-1 max-w-2xl text-sm text-fg-muted">{{ subtitle }}</p>
        </div>
        <div class="flex items-center gap-2">
          <slot name="actions" />
        </div>
      </header>
      <slot />
    </div>
  </div>
</template>
