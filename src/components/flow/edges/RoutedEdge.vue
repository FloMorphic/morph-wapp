<script setup lang="ts">
import { computed, inject, type CSSProperties } from 'vue'
import { BaseEdge, getSmoothStepPath, type EdgeProps, type Position } from '@vue-flow/core'
import { EDGE_ZOOMED_IN, ROUTED_PATHS } from '@/lib/edgeRouting'
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
 * It also shows where the followed run went, in four layers over the same path:
 *
 *   - the edge itself, drawn as taken when control crossed it and dashed back
 *     when the routing decision rejected it;
 *   - a comet per traversal — the instant control moves;
 *   - a marching flow while the node at the far end is *still working*, which is
 *     the wait a comet cannot express: it fades in only after the target has
 *     been busy for a moment, so a node that returns at once never shows it, and
 *     it thins out as that node's progress climbs — the edge has handed its work
 *     over, and the picture drains as the work is finished;
 *   - a blinking trace behind the line, once the canvas is zoomed in far enough
 *     for the extra layer to read as detail rather than noise.
 *
 * All of it is read from the log store; the edge data on the canvas is never
 * touched, so watching a run cannot dirty the graph.
 */
const props = defineProps<EdgeProps>()

const routes = inject(ROUTED_PATHS, null)
const zoomedIn = inject(EDGE_ZOOMED_IN, null)
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

/** Only a live process is still moving; a finished run's path is just history. */
const live = computed(() => logs.canvasRun?.status === 'running')

/**
 * The node this edge feeds, as the run sees it — the far end is what makes an
 * edge interesting while nothing is moving along it.
 */
const target = computed(() => logs.nodeRun(props.target))

/**
 * Work is happening at the far end of this edge right now.
 *
 * A parked join is `running` on the wire but is not working — it is waiting for
 * the *other* branches, and this one has already delivered — so it does not
 * flow. Everything else the target is doing does.
 */
const busy = computed(
  () => live.value && !!run.value?.taken && target.value?.status === 'running' && !target.value.wait,
)

/** The target's latest progress frame, 0–100, or null when it publishes none. */
const progress = computed(() => (busy.value ? target.value?.progress?.percent ?? null : null))

/**
 * Drawn back: evaluated and decided against. It gets no casing — the dashes are
 * meant to recede, and a solid canvas-coloured band behind them would read as a
 * line in its own right, wiping the background dots along a path nothing took.
 */
const pruned = computed(() => !!run.value && !run.value.taken && run.value.pruned)

const runClass = computed(() => {
  const state = run.value
  if (!state) return undefined
  // Taken is sticky and wins: a loop can prune on one pass an edge it took on
  // another, and the fact that the flow actually went that way is the thing a
  // path view exists to show.
  if (state.taken) return busy.value ? 'run-edge-taken run-edge-draining' : 'run-edge-taken'
  if (state.pruned) return 'run-edge-pruned'
  return undefined
})

/**
 * The target's progress, published to CSS rather than applied here.
 *
 * Going through a custom property keeps the run's colouring in the stylesheet,
 * *below* the hover and selection rules (see vue-flow.css) — an inline stroke
 * would beat them, and pointing at an edge to trace it has to keep winning. The
 * stroke transition already on `.vue-flow__edge-path` carries the change, so the
 * line drains as the frames arrive and recovers when the node exits.
 */
const edgeStyle = computed<CSSProperties>(() => {
  const base = (props.style ?? {}) as CSSProperties
  if (progress.value === null) return base
  return { ...base, '--run-progress': progress.value }
})

/**
 * Opacity of the flow layer: full while the node has said nothing about how far
 * along it is, thinning out as it fills up. Kept on the group so the marching
 * dashes' own fade-in animation (a plain 0 → 1) multiplies into it.
 */
const flowStyle = computed<CSSProperties>(() => ({
  opacity: 1 - 0.6 * ((progress.value ?? 0) / 100),
}))

/**
 * Key for the comet: the seq of the last traversal.
 *
 * Re-keying replaces the element, which is what restarts the CSS animation —
 * so a loop that crosses the same edge again fires the comet again, instead of
 * showing one animation that already played.
 */
const pulseKey = computed(() => (run.value?.taken ? run.value.seq : null))

const showPulse = computed(() => pulseKey.value !== null && live.value)

/**
 * Key for the flow layer: when the target entered.
 *
 * The same re-keying trick, and here it is what makes "long running" mean
 * anything — the dashes are delayed a beat behind the mount, so the delay is
 * measured from the moment *this* pass started working, and a second pass
 * through the same node starts the wait over instead of inheriting it.
 */
const flowKey = computed(() => target.value?.enteredAt ?? 0)

/** The blinking backing line: where the run has been, read from up close. */
const showTrace = computed(() => !!run.value?.taken && !!zoomedIn?.value)

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
  <!-- The casing: a canvas-coloured stroke under the edge, so crossing lines stay
       tellable apart. A painted stroke rather than a filter on the edges layer —
       see the note in vue-flow.css, a filter there clips every edge to a box the
       size of the container. -->
  <path v-if="!pruned" class="run-edge-casing" :d="path" />
  <!-- Behind the line, so the edge itself stays the thing you read. -->
  <path v-if="showTrace" class="run-edge-trace" :d="path" fill="none" />
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
    :marker-start="markerStart"
    :style="edgeStyle"
    :class="runClass"
    :label="edgeLabel"
    :label-x="routed?.labelX"
    :label-y="routed?.labelY"
    :label-show-bg="true"
  />
  <!-- Still flowing: the node at the far end is working on what came down here. -->
  <g v-if="busy" :key="flowKey" class="run-edge-flow" :style="flowStyle">
    <path class="run-edge-flow-dash" :d="path" fill="none">
      <title v-if="tooltip">{{ tooltip }}</title>
    </path>
  </g>
  <!-- The comet: one dash sent along the path each time control crosses it, with
       a wider translucent one under it for the glow. -->
  <template v-if="showPulse">
    <path
      :key="`glow-${pulseKey ?? 0}`"
      class="run-edge-comet run-edge-comet-glow"
      :d="path"
      pathLength="100"
    />
    <path :key="pulseKey ?? 0" class="run-edge-comet" :d="path" pathLength="100">
      <title v-if="tooltip">{{ tooltip }}</title>
    </path>
  </template>
</template>
