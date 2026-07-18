<script setup lang="ts">
import { markRaw, nextTick, ref, type Component } from 'vue'
import { VueFlow, useVueFlow, MarkerType, type Connection, type GraphNode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import FlowNode from './nodes/FlowNode.vue'
import NodePalette from './NodePalette.vue'
import { NODE_SPECS, DEFAULT_START_KIND, type NodeSpec, type NodeKind } from '@/data/nodeCatalog'
import type { VueFlowGraph } from '@/types/api'
import { createId } from '@/lib/id'

const emit = defineEmits<{
  (e: 'select', node: GraphNode | null): void
  (e: 'dirty'): void
}>()

// Loosely typed on purpose: Vue Flow's Node/Edge generics are deeply recursive
// and blow up strict TS 6 instantiation (and its v-model expects its own types).
// The canvas owns this internal model; the clean, strongly-typed serialisable
// shape is produced by getGraph() below (VueFlowGraph).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodes = ref<any[]>([])
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edges = ref<any[]>([])

const nodeTypes: Record<string, Component> = Object.fromEntries(
  (Object.keys(NODE_SPECS) as NodeKind[]).map((k) => [k, markRaw(FlowNode)]),
)

const { onConnect, onNodeClick, onPaneClick, screenToFlowCoordinate, fitView, setViewport, viewport } =
  useVueFlow()

let addOffset = 0

function addNode(kind: NodeKind, position?: { x: number; y: number }): string {
  const spec = NODE_SPECS[kind]
  const id = createId('n')
  const pos = position ?? { x: 120 + ((addOffset % 6) * 30), y: 120 + ((addOffset % 6) * 30) }
  addOffset++
  nodes.value.push({ id, type: spec.type, position: pos, data: spec.defaults() })
  emit('dirty')
  return id
}

onConnect((params: Connection) => {
  edges.value.push({
    id: createId('e'),
    source: params.source,
    target: params.target,
    sourceHandle: params.sourceHandle,
    targetHandle: params.targetHandle,
    type: 'default',
    markerEnd: MarkerType.ArrowClosed,
    data: { tags: [] },
  })
  emit('dirty')
})

onNodeClick(({ node }) => emit('select', node))
onPaneClick(() => emit('select', null))

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(e: DragEvent) {
  const kind = e.dataTransfer?.getData('application/flomorphic-node') as NodeKind
  if (!kind || !NODE_SPECS[kind]) return
  const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  addNode(kind, position)
}

function onPaletteAdd(spec: NodeSpec) {
  addNode(spec.kind)
}

// ---- Parent-facing API ----
function loadGraph(graph: VueFlowGraph, seedStart = false) {
  nodes.value = graph?.nodes?.length
    ? [...graph.nodes]
    : seedStart
      ? [
          {
            id: createId('n'),
            type: DEFAULT_START_KIND,
            position: { x: 80, y: 200 },
            data: NODE_SPECS[DEFAULT_START_KIND].defaults(),
          },
        ]
      : []
  edges.value = graph?.edges ? [...graph.edges] : []
  nextTick(() => {
    const p = graph?.position
    if (p && typeof p.x === 'number') setViewport({ x: p.x, y: p.y, zoom: p.zoom })
    else fitView({ padding: 0.3 })
  })
}

function getGraph(): VueFlowGraph {
  // Clean, serialisable graph from the refs (dropping any runtime-only fields
  // Vue Flow may attach) plus the current viewport.
  const cleanNodes: VueFlowGraph['nodes'] = nodes.value.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: n.data,
  }))
  const cleanEdges: VueFlowGraph['edges'] = edges.value.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    type: e.type,
    data: e.data,
  }))
  const vp = viewport.value
  return { nodes: cleanNodes, edges: cleanEdges, position: { x: vp.x, y: vp.y, zoom: vp.zoom } }
}

function removeSelected(node: GraphNode | null) {
  if (!node) return
  nodes.value = nodes.value.filter((n) => n.id !== node.id)
  edges.value = edges.value.filter((e) => e.source !== node.id && e.target !== node.id)
  emit('select', null)
  emit('dirty')
}

defineExpose({ addNode, loadGraph, getGraph, removeSelected, fitView })
</script>

<template>
  <div class="relative h-full w-full" @drop="onDrop" @dragover="onDragOver">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :default-viewport="{ zoom: 1 }"
      :min-zoom="0.2"
      :max-zoom="2.5"
      fit-view-on-init
      class="h-full w-full"
      @nodes-change="emit('dirty')"
      @edges-change="emit('dirty')"
    >
      <Background :gap="18" :size="1.4" pattern-color="var(--canvas-dots)" />
      <Controls position="bottom-right" />
      <MiniMap pannable zoomable />
    </VueFlow>

    <NodePalette @add="onPaletteAdd" />
  </div>
</template>
