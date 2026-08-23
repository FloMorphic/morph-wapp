<script setup lang="ts">
import { computed, inject } from 'vue'
import { BaseEdge, getSmoothStepPath, type EdgeProps, type Position } from '@vue-flow/core'
import { ROUTED_PATHS } from '@/lib/edgeRouting'

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
 */
const props = defineProps<EdgeProps>()

const routes = inject(ROUTED_PATHS, null)

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
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" :marker-start="markerStart" :style="style" />
</template>
