<script setup lang="ts">
import { computed, inject } from 'vue'
import { BaseEdge, getSmoothStepPath, type EdgeProps, type Position } from '@vue-flow/core'
import { ROUTED_PATHS } from '@/lib/edgeRouting'
import { useFlowLogsStore } from '@/stores/flowLogs'

/**
 * The canvas' edge renderer. Its path is not computed here — the canvas routes
 * every edge together (it needs all the node rectangles as obstacles) and shares
 * the result through the {@link ROUTED_PATHS} map, so this component only looks
 * up its own id and draws it.
 *
 * Until that map has a route (nothing measured yet, nodes overlapping, or a
 * frame before the reroute runs) it falls back to Vue Flow's own smoothstep
 * path from the endpoint props — the edge is always drawn, never blank. The
 * `<path>` BaseEdge emits carries the `.vue-flow__edge-path` class, so the theme,
 * the hover/select highlight and the halo in vue-flow.css all apply unchanged.
 *
 * It also shows where the followed run went: an edge control crossed is drawn
 * as taken, one the routing decision rejected is dashed back, and each new
 * traversal fires a comet along the path — the movement between nodes that the
 * node badges alone cannot show. All of it is read from the log store; the edge
 * data on the canvas is never touched, so watching a run cannot dirty the graph.
 */
const props = defineProps<EdgeProps>()

const routes = inject(ROUTED_PATHS, null)
const logs = useFlowLogsStore()

const routed = computed(() => routes?.value.get(props.id) ?? null)

const fallback = computed(() => {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition as Position,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition as Position,
    borderRadius: 10,
  })
  return path
})

const path = computed(() => routed.value?.path ?? fallback.value)

const run = computed(() => logs.edgeRun(props.id))

const runClass = computed(() => {
  const state = run.value
  if (!state) return undefined
  // Taken is sticky and wins: a loop can prune on one pass an edge it took on
  // another, and the fact that the flow actually went that way is the thing a
  // path view exists to show.
  if (state.taken) return 'run-edge-taken'
  if (state.pruned) return 'run-edge-pruned'
  return undefined
})

/**
 * Key for the comet: the seq of the last traversal.
 *
 * Re-keying replaces the element, which is what restarts the CSS animation —
 * so a loop that crosses the same edge again fires the comet again, instead of
 * showing one animation that already played.
 */
const pulseKey = computed(() => (run.value?.taken ? run.value.seq : null))

/** Only a live process is still moving; a finished run's path is just history. */
const showPulse = computed(() => pulseKey.value !== null && logs.canvasRun?.status === 'running')

const tooltip = computed(() => {
  const state = run.value
  if (!state) return undefined
  if (state.taken) return `Taken ${state.takenCount}×${state.tags.length ? ` · ${state.tags.join(', ')}` : ''}`
  return `Not taken${state.tags.length ? ` · ${state.tags.join(', ')}` : ''}`
})

/**
 * A pass count on the edge, which is the only place a loop is visible at all —
 * the nodes at either end each show their own count, but not that these two are
 * going round together. Falls back to whatever label the edge itself carries.
 */
const edgeLabel = computed(() => {
  const count = run.value?.takenCount ?? 0
  return count > 1 ? `×${count}` : (props.label as string | undefined)
})
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
    :marker-start="markerStart"
    :style="style"
    :class="runClass"
    :label="edgeLabel"
    :label-x="routed?.labelX"
    :label-y="routed?.labelY"
    :label-show-bg="true"
  />
  <!-- The comet: one dash sent along the path each time control crosses it. -->
  <path
    v-if="showPulse"
    :key="pulseKey ?? 0"
    class="run-edge-comet"
    :d="path"
    pathLength="100"
    fill="none"
  >
    <title v-if="tooltip">{{ tooltip }}</title>
  </path>
</template>
