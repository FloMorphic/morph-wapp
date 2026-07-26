<script setup lang="ts">
import { markRaw, nextTick, ref, type Component } from 'vue'
import { VueFlow, useVueFlow, MarkerType, type Connection, type GraphNode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import FlowNode from './nodes/FlowNode.vue'
import NodePalette from './NodePalette.vue'
import { NODE_SPECS, DEFAULT_START_KIND, portTags, type NodeSpec, type NodeKind } from '@/data/nodeCatalog'
import type { VueFlowGraph } from '@/types/api'
import type { NodeExtRef } from '@/lib/nodeSettings'
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

// Flow-control kinds with no result binding: their key / scope are meaningless
// and are serialised as empty strings (see getGraph). Start is a bare entry
// marker, Continue After only parks/resumes the flow, Wait-for-All is a pure
// join, and Goto just redirects the flow.
const NO_BINDING_KINDS = new Set<string>(['startNode', 'until', 'promissall', 'goto'])

const {
  onConnect,
  onNodeClick,
  onPaneClick,
  onEdgeUpdate,
  onNodesChange,
  screenToFlowCoordinate,
  fitView,
  setViewport,
  viewport,
  updateEdge,
} = useVueFlow()

// Minimap visibility, toggled from the editor toolbar (see WorkflowEditorView).
const showMinimap = ref(true)

function toggleMinimap() {
  showMinimap.value = !showMinimap.value
}

let addOffset = 0

function addNode(kind: NodeKind, position?: { x: number; y: number }, ext?: NodeExtRef): string {
  const spec = NODE_SPECS[kind]
  const id = createId('n')
  const pos = position ?? { x: 120 + ((addOffset % 6) * 30), y: 120 + ((addOffset % 6) * 30) }
  addOffset++
  const data = spec.defaults() as Record<string, unknown>
  // Stamp the backing extension row's identity so the compiler can register the
  // node (plugin uniqId) under the exact id the extension table holds.
  if (ext?.extensionId) {
    data.extensionId = ext.extensionId
    if (ext.pluginId) data.pluginId = ext.pluginId
  }
  nodes.value.push({ id, type: spec.type, position: pos, data })
  emit('dirty')
  return id
}

// ---- Routed-port tags ------------------------------------------------------
// The engine routes by tag alone: a node fires tags (the LLM plugin fires the
// name of the tool the model called) and only outbound edges carrying a
// matching tag continue. Nothing on the engine side reads the source node's
// config, so a routed port's tag has to live on the edge — see NodePort.tags.
// Tags are re-derived from node data rather than frozen at connect time, so
// renaming a function re-tags the edges already drawn from its port.
function tagsForPort(sourceId?: string | null, handleId?: string | null): string[] | undefined {
  return portTags(nodes.value.find((n) => n.id === sourceId), handleId)
}

/** Re-stamp every edge whose source port dictates tags. */
function syncPortTags() {
  for (const e of edges.value) {
    const tags = tagsForPort(e.source, e.sourceHandle)
    if (tags) e.data = { ...(e.data ?? {}), tags }
  }
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
    data: { tags: tagsForPort(params.source, params.sourceHandle) ?? [] },
  })
  emit('dirty')
})

// Dragging an existing edge's endpoint onto another handle re-wires it in place
// — and onto a different port, so its tags are re-derived once Vue Flow has
// pushed the new connection back into `edges`.
onEdgeUpdate(({ edge, connection }) => {
  updateEdge(edge, connection, false)
  void nextTick(syncPortTags)
  emit('dirty')
})

// Delete-key removal targets the selected node; clear the config panel with it
// so it never shows a node that no longer exists.
onNodesChange((changes) => {
  if (changes.some((c) => c.type === 'remove')) emit('select', null)
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
  addNode(kind, position, parseExtPayload(e.dataTransfer?.getData('application/flomorphic-ext')))
}

function onPaletteAdd(spec: NodeSpec, ext?: NodeExtRef) {
  addNode(spec.kind, undefined, ext)
}

/** Parse the optional extension-identity payload attached to a palette drag. */
function parseExtPayload(raw?: string): NodeExtRef | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as NodeExtRef
  } catch {
    return undefined
  }
}

// ---- Parent-facing API ----
// Saved graphs can come back carrying Vue Flow runtime-only fields (dimensions,
// computedPosition, handleBounds, initialized, selected, …). If those are fed
// back into v-model they're treated as authoritative measured values, so every
// node renders at size 0 / position 0,0 and edges have nothing to attach to.
// Strip everything back to the clean, serialisable shape getGraph() produces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeNode(n: any) {
  return {
    id: n.id,
    type: n.type,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: n.data,
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeEdge(e: any) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || null,
    targetHandle: e.targetHandle || null,
    type: e.type || 'default',
    markerEnd: MarkerType.ArrowClosed,
    data: e.data,
  }
}

function loadGraph(graph: VueFlowGraph, seedStart = false) {
  nodes.value = graph?.nodes?.length
    ? graph.nodes.map(sanitizeNode)
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
  edges.value = graph?.edges ? graph.edges.map(sanitizeEdge) : []
  // Flows saved before routed ports stamped their tags come back untagged, so
  // re-derive on load: the graph is then correct in memory and the next save
  // writes the tags out. Not a dirty edit — nothing the user did changed.
  syncPortTags()
  nextTick(() => {
    const p = graph?.position
    if (p && typeof p.x === 'number') setViewport({ x: p.x, y: p.y, zoom: p.zoom })
    else fitView({ padding: 0.3 })
  })
}

function getGraph(): VueFlowGraph {
  // Clean, serialisable graph from the refs (dropping any runtime-only fields
  // Vue Flow may attach) plus the current viewport. Routed-port tags are
  // refreshed first: the drawer edits node data (a function's name) without
  // touching the edges, so this is where a rename reaches them.
  syncPortTags()
  const cleanNodes: VueFlowGraph['nodes'] = nodes.value.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    // Flow-control nodes with no result binding (Start / Continue After /
    // Wait-for-All) always send key / scope empty, regardless of any stale value.
    data: NO_BINDING_KINDS.has(n.type) ? { ...n.data, key: '', scope: '' } : n.data,
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

defineExpose({ addNode, loadGraph, getGraph, removeSelected, fitView, showMinimap, toggleMinimap })
</script>

<template>
  <div class="relative h-full w-full" @drop="onDrop" @dragover="onDragOver">
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" :node-types="nodeTypes" :edges-updatable="true"
      :delete-key-code="['Delete', 'Backspace']" :default-viewport="{ zoom: 1 }" :min-zoom="0.2" :max-zoom="2.5"
      class="h-full w-full" @nodes-change="emit('dirty')" @edges-change="emit('dirty')">
      <Background :gap="18" :size="1.4" pattern-color="var(--canvas-dots)" />
      <Controls position="bottom-right" />
      <MiniMap v-if="showMinimap" pannable zoomable />
    </VueFlow>

    <NodePalette @add="onPaletteAdd" />
  </div>
</template>
