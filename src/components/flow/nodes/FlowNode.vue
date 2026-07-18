<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import { specForType, type BaseNodeData } from '@/data/nodeCatalog'

/**
 * A single generic node renderer, driven entirely by the node catalog. Vue Flow
 * registers this component for every FloMorphic node `type`, so the visual
 * language stays uniform and a new node kind is a catalog entry — not a new
 * component. The "compiles to" line shows the Inflowenger primitive it lowers to.
 */
const props = defineProps<{
  id: string
  type: string
  data: BaseNodeData
  selected?: boolean
}>()

const spec = computed(() => specForType(props.type))
const accent = computed(() => spec.value?.color ?? 'var(--fg-subtle)')
const title = computed(() => props.data?.title || spec.value?.label || 'Node')
const preview = computed(() => spec.value?.preview?.(props.data) ?? spec.value?.tagline ?? '')

const hasTarget = computed(() => !spec.value?.entry)
const hasSource = computed(() => !spec.value?.terminal)
</script>

<template>
  <div
    class="flow-node relative rounded-xl border bg-elevated transition-shadow"
    :style="{
      borderColor: selected ? accent : 'var(--line)',
      boxShadow: selected ? `0 0 0 1px ${accent}, var(--shadow-md)` : 'var(--shadow-sm)',
    }"
  >
    <Handle v-if="hasTarget" type="target" :position="Position.Left" />

    <div class="flex items-center gap-2.5 px-3 py-2">
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        :style="{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }"
      >
        <Icon :name="spec?.icon ?? 'info'" :size="16" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13px] font-semibold leading-tight text-fg">{{ title }}</p>
        <p class="truncate text-[11px] leading-tight text-fg-subtle">{{ spec?.label }}</p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 border-t px-3 py-1.5">
      <span class="truncate font-mono text-[10.5px] text-fg-muted">{{ preview }}</span>
      <span
        v-if="spec"
        class="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
        :style="{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }"
        :title="`Compiles to ${spec.primitives}`"
      >
        {{ spec.primitives }}
      </span>
    </div>

    <Handle v-if="hasSource" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.flow-node {
  width: 194px;
}
</style>
