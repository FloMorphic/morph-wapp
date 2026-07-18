<script setup lang="ts">
import PageShell from './PageShell.vue'
import Icon from './Icon.vue'

defineProps<{
  title: string
  subtitle: string
  icon: string
  points: { icon: string; label: string; text: string }[]
  primitive?: string
}>()
</script>

<template>
  <PageShell :title="title" :subtitle="subtitle">
    <template #actions>
      <span v-if="primitive" class="chip">Runtime: {{ primitive }}</span>
    </template>

    <div class="mb-6 rounded-xl border border-dashed bg-surface-2 px-5 py-4 text-sm text-fg-muted">
      <span class="font-medium text-fg">Scaffolded.</span>
      This section is part of the FloMorphic base plate — the model and layout are wired, and it lights up
      against the Inflowenger <code class="font-mono text-xs text-accent">inspector-api</code> backend.
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="p in points" :key="p.label" class="card p-4">
        <span class="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon :name="p.icon" :size="18" />
        </span>
        <h3 class="text-sm font-semibold text-fg">{{ p.label }}</h3>
        <p class="mt-1 text-[13px] leading-relaxed text-fg-muted">{{ p.text }}</p>
      </div>
    </div>
  </PageShell>
</template>
