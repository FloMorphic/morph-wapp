<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import Icon from '@/components/ui/Icon.vue'
import { errorKind, errorKindClass, formatErrorTime } from '@/lib/process'
import type { RunErrorKind, RunErrors } from '@/types/api'

/**
 * One run's error ledger, as a list.
 *
 * The engine names nodes by id only — titles live in the editor, not on the
 * wire — so every entry's node is resolved against the saved graph the same way
 * the log drawer resolves a line (flowGraphs), with the id kept in the tooltip
 * because that is what the canvas and every other view keys on.
 *
 * Shared by the two places a run's errors are read: expanded under its row in
 * the process list, and in the run's detail panel.
 */
const props = defineProps<{ errors: RunErrors }>()

const graphs = useFlowGraphsStore()

// Each entry names its own flow — a run that went through a GoTo has entries
// from more than one — so every flow mentioned is pulled in, lazily, and the
// rows re-render as the graphs land.
watchEffect(() => {
  for (const item of props.errors.items) {
    if (item.flow) graphs.ensure(item.flow)
  }
})

/** What a kind badge means, spelled out — the distinction is the point of the
 * badge and is not obvious from one word. */
function kindHint(kind: RunErrorKind): string {
  return kind === 'system'
    ? 'A platform error: nothing in the flow caused it and nothing in the flow mends it'
    : 'The flow’s own error: its node data, its js or rego, or something its node called that did not deliver'
}

const rows = computed(() =>
  props.errors.items.map((item, i) => {
    const kind = errorKind(item)
    return {
      ...item,
      kind,
      // ts alone does not separate two errors raised in the same millisecond on
      // a fan-out, so the index goes in the key.
      key: `${item.ts}-${item.node}-${i}`,
      title: (item.node && graphs.node(item.flow, item.node)?.title) || item.node,
      tip: item.node ? graphs.describe(item.flow, 'node', item.node) : '',
    }
  }),
)

/**
 * How many entries the engine counted but did not carry. The header rides
 * inside the context document, which has a publish limit, so a cascading run's
 * entries are capped at the earliest ones — saying so is what stops the list
 * reading as the whole story.
 */
const dropped = computed(() => Math.max(0, props.errors.count - props.errors.items.length))
</script>

<template>
  <div class="space-y-1.5">
    <ul class="space-y-1.5">
      <li
        v-for="row in rows"
        :key="row.key"
        class="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]"
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="errorKindClass(row.kind)"
            :title="kindHint(row.kind)"
          >
            {{ row.kind }}
          </span>
          <span v-if="row.node" class="font-medium text-fg" :title="row.tip">{{ row.title }}</span>
          <span v-if="row.src" class="font-mono text-[11px] text-fg-subtle" title="The actor that raised it">
            {{ row.src }}
          </span>
          <span v-if="row.code" class="font-mono text-[11px] text-fg-subtle" title="Engine status code">
            #{{ row.code }}
          </span>
          <span v-if="row.ts" class="ml-auto font-mono text-[11px] text-fg-subtle">
            {{ formatErrorTime(row.ts) }}
          </span>
        </div>
        <p class="mt-1 break-words text-fg-muted">{{ row.msg || '—' }}</p>
        <!-- Only a node running over a fan-out has one, and then the node id
             alone does not place the failure. -->
        <p v-if="row.loc" class="mt-0.5 font-mono text-[11px] text-fg-subtle" title="Path the failure happened on">
          at {{ row.loc }}
        </p>
      </li>
    </ul>

    <p v-if="dropped" class="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <Icon name="info" :size="12" />
      {{ dropped }} more error{{ dropped === 1 ? '' : 's' }} were recorded but not carried — the ledger keeps the
      earliest {{ props.errors.items.length }}, which is where a cascade starts.
    </p>
  </div>
</template>
