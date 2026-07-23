<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { parseRefs, resolveRefs } from '@inflowenger/flow-trace'
import { useFlowGraphsStore } from '@/stores/flowGraphs'

/**
 * Renders a log line, resolving every id it mentions against the saved graph.
 *
 * The runtime stream names nodes and edges by id only — titles live in the
 * editor, not on the wire. So any `n_…` / `e_…` in a message (whoever wrote it:
 * the runtime, a plugin, a JS node) is swapped for the title the canvas draws,
 * with the id kept in the tooltip because that is what every other view keys on.
 * The splitting and naming is flow-trace's `resolveRefs`; this component only
 * supplies the graph and the markup.
 */
const props = defineProps<{
  text: string
  /** The flow bare ids belong to — the event's own flow. */
  flow?: string
  /** Title to use when the graph can't name a node (e.g. `node.enter`). */
  fallback?: string
}>()

const graphs = useFlowGraphsStore()

// Lazy by construction: a flow is fetched the first time a line that mentions
// it is actually rendered, and the parts re-render when it lands. Kept off the
// resolved computed so fetching never depends on what resolving observed.
watchEffect(() => {
  for (const token of parseRefs(props.text, props.flow)) {
    if (token.kind !== 'text') graphs.ensure(token.flow)
  }
})

const parts = computed(() =>
  resolveRefs(props.text, graphs, { flow: props.flow, fallback: props.fallback }).map((part) => ({
    ...part,
    // The id is what the canvas, the URL and every other event key on, so it
    // stays reachable even when a title is shown.
    tip: part.kind === 'text' ? undefined : graphs.describe(part.flow, part.kind, part.id),
  })),
)
</script>

<template>
  <span class="break-words">
    <template v-for="(part, i) in parts" :key="i">
      <span v-if="part.kind === 'text'">{{ part.label }}</span>
      <span
        v-else-if="part.kind === 'node'"
        class="cursor-help underline decoration-dotted underline-offset-2"
        :class="part.known ? 'text-fg' : 'text-fg-muted'"
        :title="part.tip"
        >{{ part.label }}</span
      >
      <span
        v-else
        class="cursor-help rounded px-1 text-[10px]"
        :class="part.known ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'text-fg-subtle'"
        :title="part.tip"
        >{{ part.label }}</span
      >
    </template>
  </span>
</template>
