<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * One row of the expandable JSON tree (recursive). Renders `field: value` with
 * a type badge; objects and arrays expand into indented child rows. Used by
 * the context detail page's Tree view.
 */
defineOptions({ name: 'JsonTreeNode' })

const props = withDefaults(
  defineProps<{
    field: string
    value: unknown
    depth?: number
  }>(),
  { depth: 0 },
)

// Deep levels start collapsed so large documents stay scannable.
const isExpanded = ref(props.depth < 2)

type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined'

function getType(v: unknown): JsonType {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v as JsonType
}

const type = getType(props.value)
const expandable = type === 'object' || type === 'array'

function preview(v: unknown): string {
  const t = getType(v)
  if (t === 'array') return `[${(v as unknown[]).length}]`
  if (t === 'object') {
    const n = Object.keys(v as object).length
    return `{${n} field${n === 1 ? '' : 's'}}`
  }
  return String(v)
}

function formatValue(v: unknown): string {
  const t = getType(v)
  if (t === 'string') return JSON.stringify(v)
  if (t === 'null') return 'null'
  return String(v)
}

/** Per-type text color, readable in both themes. */
const valueClass: Record<JsonType, string> = {
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-pink-600 dark:text-pink-400',
  boolean: 'text-sky-600 dark:text-sky-400',
  null: 'text-fg-subtle',
  array: 'text-amber-600 dark:text-amber-400',
  object: 'text-violet-600 dark:text-violet-400',
  undefined: 'text-fg-subtle',
}

const badgeClass: Record<JsonType, string> = {
  string: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  number: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  boolean: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  null: 'bg-surface-2 text-fg-subtle',
  array: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  object: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  undefined: 'bg-surface-2 text-fg-subtle',
}
</script>

<template>
  <div class="font-mono text-[13px] leading-relaxed">
    <div
      class="flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-accent-soft/50"
      :class="expandable ? 'cursor-pointer' : 'cursor-default'"
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @click="expandable && (isExpanded = !isExpanded)"
    >
      <span class="flex w-4 shrink-0 items-center justify-center text-fg-subtle">
        <Icon
          v-if="expandable"
          name="chevron-right"
          :size="12"
          class="transition-transform"
          :class="isExpanded ? 'rotate-90' : ''"
        />
      </span>

      <span class="font-medium text-accent">{{ field }}</span>
      <span class="mr-1 text-fg-subtle">:</span>

      <span v-if="!expandable" class="break-all" :class="valueClass[type]">{{ formatValue(value) }}</span>
      <span v-else class="italic text-fg-muted">{{ preview(value) }}</span>

      <span
        class="ml-auto shrink-0 rounded px-1 text-[10px] font-semibold lowercase"
        :class="badgeClass[type]"
      >
        {{ type }}
      </span>
    </div>

    <div v-if="expandable && isExpanded">
      <template v-if="Array.isArray(value)">
        <JsonTreeNode
          v-for="(item, index) in value"
          :key="index"
          :field="String(index)"
          :value="item"
          :depth="depth + 1"
        />
      </template>
      <template v-else>
        <JsonTreeNode
          v-for="[k, v] in Object.entries(value as Record<string, unknown>)"
          :key="k"
          :field="k"
          :value="v"
          :depth="depth + 1"
        />
      </template>
    </div>
  </div>
</template>
