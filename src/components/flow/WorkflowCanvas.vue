<script setup lang="ts">
import { markRaw, nextTick, ref, type Component } from 'vue'
import { VueFlow, useVueFlow, getRectOfNodes, MarkerType, type Connection, type GraphNode } from '@vue-flow/core'
import { toPng } from 'html-to-image'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import FlowNode from './nodes/FlowNode.vue'
import NodePalette from './NodePalette.vue'
import {
  NODE_SPECS,
  DEFAULT_START_KIND,
  portTags,
  specForType,
  type BaseNodeData,
  type NodeSpec,
  type NodeKind,
} from '@/data/nodeCatalog'
import type { VueFlowGraph } from '@/types/api'
import type { NodeExtRef } from '@/lib/nodeSettings'
import { fetchNodeExtRefs } from '@/lib/nodeExtRefs'
import type { PlannedPatch } from '@/lib/aiGraph'
import { layeredLayout } from '@/lib/graphLayout'
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
  findNode,
  fitView,
  setViewport,
  viewport,
  updateEdge,
  getNodes,
  vueFlowRef,
} = useVueFlow()

// Minimap visibility, toggled from the editor toolbar (see WorkflowEditorView).
// Off by default — it covers a corner of the canvas, so it is opt-in per session.
const showMinimap = ref(false)

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
    // A node contributed by an imported plugin also arrives with the method it
    // calls and the form that method advertised, so it is self-contained from
    // the moment it lands: the drawer can render its fields, and the compiler
    // knows which action to request, with no further round trip to the plugin.
    if (ext.action) {
      data.action = ext.action
      data.title = ext.label || String(data.title ?? '')
      if (ext.form) data.form = ext.form
      // Declared branch ports (SDK Action.Outbound): carried so the node renders
      // one output port per entry and its edges inherit each port's route tags.
      // A plugin without them keeps the single default source handle.
      if (ext.outbound?.length) data.outbound = ext.outbound
    }
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

/**
 * Add an AI-designed subgraph to the canvas ({@link PlannedPatch} — already
 * validated and laid out by lib/aiGraph, so this only has to place it).
 *
 * Purely additive: nothing already on the canvas is moved or rewritten, so an
 * unwanted patch is undone by deleting the nodes it added. Plugin nodes are
 * stamped with the same extension identity the palette attaches to a drag, and
 * edge tags are derived from the ports exactly as a hand-drawn edge's are — a
 * node from here is indistinguishable from one dropped by hand.
 */
async function applyPatch(patch: PlannedPatch): Promise<void> {
  if (patch.nodes.length === 0 && patch.edges.length === 0) return
  const refs = await fetchNodeExtRefs()

  for (const n of patch.nodes) {
    const data = { ...n.data } as Record<string, unknown>
    const ext = refs?.[n.type]
    if (ext?.extensionId) {
      data.extensionId = ext.extensionId
      if (ext.pluginId) data.pluginId = ext.pluginId
    }
    nodes.value.push({ id: n.id, type: n.type, position: { ...n.position }, data })
  }

  // After the nodes are in place, so a port's tags can be derived from them.
  for (const e of patch.edges) {
    edges.value.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'default',
      markerEnd: MarkerType.ArrowClosed,
      data: { tags: tagsForPort(e.source, e.sourceHandle) ?? [] },
    })
  }

  emit('dirty')
  const added = patch.nodes.map((n) => n.id)
  if (added.length) void nextTick(() => fitView({ nodes: added, padding: 0.35, duration: 300 }))
}

/**
 * Re-lay the whole canvas out left → right ({@link layeredLayout}): columns by
 * hop count, rows ordered to cut edge crossings, spaced by each node's *measured*
 * height so no edge is forced to cut across a node on its way past. This is the
 * cure for a graph that has grown tangled — hand-dragged positions are the cost,
 * which is why it is an explicit toolbar action and not something that runs on
 * its own.
 *
 * Sizes come from Vue Flow's measured `dimensions`; a node that has not been
 * rendered yet falls back to the layout defaults.
 */
function autoArrange() {
  if (nodes.value.length === 0) return

  const placements = layeredLayout(
    nodes.value.map((n) => {
      const measured = findNode(n.id)?.dimensions
      return { id: n.id, width: measured?.width, height: measured?.height }
    }),
    edges.value.map((e) => ({ source: e.source, target: e.target, rank: portRank(e.source, e.sourceHandle) })),
  )

  for (const n of nodes.value) {
    const p = placements.get(n.id)
    if (p) n.position = { x: p.x, y: p.y }
  }
  emit('dirty')
  void nextTick(() => fitView({ padding: 0.2, duration: 400 }))
}

/**
 * Where an edge's source port sits on its node. Branches off a multi-port node
 * (an LLM's functions, a Rule's handlers) are then laid out in the same order
 * the ports are drawn in, so their edges fan out instead of crossing over.
 */
function portRank(sourceId?: string | null, handleId?: string | null): number {
  if (!sourceId || !handleId) return 0
  const node = nodes.value.find((n) => n.id === sourceId)
  const i = specForType(String(node?.type ?? ''))?.ports?.(node?.data as BaseNodeData)?.findIndex((p) => p.id === handleId) ?? -1
  return i < 0 ? 0 : i
}

// ---- Snapshot --------------------------------------------------------------
// Margin around the graph, and the widest/tallest the rendered graph may be
// before it is scaled down to fit (in CSS px, before pixelRatio).
const SNAPSHOT_MARGIN = 64
const SNAPSHOT_MAX = 2400

// The paints an SVG child can only get from a stylesheet — see withInlineSvgPaint.
const SVG_PAINT_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
]

/**
 * Run `capture` with every SVG child's painted style written out as an inline
 * one, then put the DOM back exactly as it was.
 *
 * html-to-image inlines each element's computed style as it clones — that is
 * how the image gets the app's CSS at all — but an `<svg>` is deep-cloned in
 * one go, so its *children* are copied as raw markup and keep only their
 * presentation attributes. Vue Flow paints edges from a stylesheet
 * (`.vue-flow__edge-path { fill: none; stroke: … }`), so without this every
 * edge would come out as a black filled blob. The inlined values are the
 * computed ones, so nothing on screen changes while the capture runs.
 */
async function withInlineSvgPaint<T>(root: HTMLElement, capture: () => Promise<T>): Promise<T> {
  const restore: [SVGElement, string | null][] = []
  for (const svg of root.querySelectorAll('svg')) {
    for (const el of svg.querySelectorAll<SVGElement>('*')) {
      if (!el.style) continue
      restore.push([el, el.getAttribute('style')])
      const computed = getComputedStyle(el)
      for (const prop of SVG_PAINT_PROPS) el.style.setProperty(prop, computed.getPropertyValue(prop))
    }
  }
  try {
    return await capture()
  } finally {
    for (const [el, style] of restore) {
      if (style === null) el.removeAttribute('style')
      else el.setAttribute('style', style)
    }
  }
}

/**
 * Render the whole graph to a PNG data URL — the canvas as it looks, not as it
 * happens to be scrolled: the element captured is Vue Flow's transformation
 * pane, and the transform it is captured under is computed here from the
 * *nodes' bounds*, so the image always frames every node whatever the viewport
 * is doing. Nothing on screen moves; the override applies to the off-document
 * clone html-to-image renders.
 *
 * Capturing that pane rather than the whole canvas is also what leaves the
 * chrome out — palette, controls, minimap and log drawer are siblings of it, so
 * the image is only the diagram (the background dots are a sibling too, hence
 * the flat `--canvas-bg` fill in their place).
 *
 * Returns null when there is nothing to show — an empty canvas, or a graph that
 * has not been measured yet.
 */
async function captureImage(): Promise<string | null> {
  const graphNodes = getNodes.value
  if (graphNodes.length === 0) return null

  const pane = vueFlowRef.value?.querySelector('.vue-flow__transformationpane') as HTMLElement | null
  if (!pane) return null

  const rect = getRectOfNodes(graphNodes)
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0) return null

  // Shrink (never enlarge) so the biggest graph still lands in a sane image.
  const zoom = Math.min(1, SNAPSHOT_MAX / rect.width, SNAPSHOT_MAX / rect.height)
  const width = Math.round(rect.width * zoom) + SNAPSHOT_MARGIN * 2
  const height = Math.round(rect.height * zoom) + SNAPSHOT_MARGIN * 2
  // Puts the bounds' top-left corner one margin in from the image's.
  const x = SNAPSHOT_MARGIN - rect.x * zoom
  const y = SNAPSHOT_MARGIN - rect.y * zoom

  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim()

  return withInlineSvgPaint(pane, () =>
    toPng(pane, {
      backgroundColor: canvasBg || '#ffffff',
      width,
      height,
      pixelRatio: 2,
      // No web fonts to inline (the app renders in system fonts), and skipping the
      // stylesheet crawl keeps the capture from failing on a cross-origin rule.
      skipFonts: true,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transformOrigin: '0 0',
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
    }),
  )
}

function removeSelected(node: GraphNode | null) {
  if (!node) return
  nodes.value = nodes.value.filter((n) => n.id !== node.id)
  edges.value = edges.value.filter((e) => e.source !== node.id && e.target !== node.id)
  emit('select', null)
  emit('dirty')
}

defineExpose({
  addNode,
  loadGraph,
  getGraph,
  applyPatch,
  autoArrange,
  captureImage,
  removeSelected,
  fitView,
  showMinimap,
  toggleMinimap,
})
</script>

<template>
  <div class="relative h-full w-full" @drop="onDrop" @dragover="onDragOver">
    <!-- elevate-*-on-select lifts what you clicked above the rest: in a dense
         graph that is how you follow one edge through a bundle of others. -->
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" :node-types="nodeTypes" :edges-updatable="true"
      :delete-key-code="['Delete', 'Backspace']" :default-viewport="{ zoom: 1 }" :min-zoom="0.2" :max-zoom="2.5"
      :elevate-edges-on-select="true" :elevate-nodes-on-select="true"
      class="h-full w-full" @nodes-change="emit('dirty')" @edges-change="emit('dirty')">
      <Background :gap="18" :size="1.4" pattern-color="var(--canvas-dots)" />
      <Controls position="bottom-right" />
      <MiniMap v-if="showMinimap" pannable zoomable />
    </VueFlow>

    <NodePalette @add="onPaletteAdd" />
  </div>
</template>
