<script setup lang="ts">
import { markRaw, nextTick, onMounted, provide, ref, type Component } from 'vue'
import { VueFlow, useVueFlow, getRectOfNodes, MarkerType, ConnectionLineType, Position, type Connection, type GraphNode } from '@vue-flow/core'
import { toPng } from 'html-to-image'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import FlowNode from './nodes/FlowNode.vue'
import RoutedEdge from './edges/RoutedEdge.vue'
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
import { fetchNodeExtRefs, fetchPluginActions, INSTALLED_PLUGIN_ACTIONS, type PluginActionEntry } from '@/lib/nodeExtRefs'
import type { PlannedPatch } from '@/lib/aiGraph'
import { namespaceOf, type PluginManifestEntry, type MissingPlugin } from '@/lib/exportFlow'
import { layeredLayout } from '@/lib/graphLayout'
import {
  routeEdge,
  roundedPath,
  midpoint,
  DEFAULT_ROUTE_OPTIONS,
  ROUTED_PATHS,
  type Rect,
  type RouteRequest,
  type RoutedPath,
  type Side,
} from '@/lib/edgeRouting'
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

// Every edge renders through the custom 'routed' type (RoutedEdge): its path is
// computed by the obstacle-avoiding router (see recomputeRoutes) so it bends
// through the empty channels *around* the nodes with a fixed clearance instead
// of cutting straight across them, and the arrowhead still lands on the port.
const EDGE_STYLE = {
  type: 'routed',
  markerEnd: MarkerType.ArrowClosed,
} as const

const edgeTypes: Record<string, Component> = { routed: markRaw(RoutedEdge) }

const {
  onConnect,
  onNodeClick,
  onPaneClick,
  onEdgeUpdate,
  onNodesChange,
  onNodesInitialized,
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
      // The action's own icon (an MDI name), so the node reads as itself on the
      // canvas rather than sharing the plugin spec's generic plug glyph.
      if (ext.icon) data.icon = ext.icon
      // The action's service sub-group, so the node is shaded within the plugin's
      // color spectrum to match its palette group.
      if (ext.className) data.className = ext.className
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
    ...EDGE_STYLE,
    data: { tags: tagsForPort(params.source, params.sourceHandle) ?? [] },
  })
  scheduleReroute()
  emit('dirty')
})

// Dragging an existing edge's endpoint onto another handle re-wires it in place
// — and onto a different port, so its tags are re-derived once Vue Flow has
// pushed the new connection back into `edges`.
onEdgeUpdate(({ edge, connection }) => {
  updateEdge(edge, connection, false)
  void nextTick(syncPortTags)
  scheduleReroute()
  emit('dirty')
})

// Node changes (drag, resize, add, remove) stream through here — reroute so the
// edges follow. Delete-key removal targets the selected node; clear the config
// panel with it so it never shows a node that no longer exists.
onNodesChange((changes) => {
  scheduleReroute()
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
    // All edges render through the routed custom type, upgrading graphs saved
    // before it (bezier 'default' / plain 'smoothstep') on load.
    type: EDGE_STYLE.type,
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
    scheduleReroute()
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
async function applyPatch(patch: PlannedPatch, plugins: PluginManifestEntry[] = []): Promise<void> {
  if (patch.nodes.length === 0 && patch.edges.length === 0) return
  const refs = await fetchNodeExtRefs()
  // A patch may reference an imported-plugin action (the prompt lists them). It
  // carries only the action; the extension row id, the action's form and any
  // outbound ports are looked up here and stamped, so a plugin node the AI added
  // is identical to one dragged from the palette (see addNode).
  const pluginActions = patch.nodes.some((n) => n.type === 'plugin') ? await fetchPluginActions() : []

  for (const n of patch.nodes) {
    const data = { ...n.data } as Record<string, unknown>
    if (n.type === 'plugin') {
      stampPluginRef(data, pluginActions)
      // Unresolved here means no local plugin provides this action — mark it as
      // an unrecognized plugin so the canvas badges it and the drawer can offer
      // the file's repo to install it (see FlowNode / NodeConfig).
      if (!data.extensionId) markMissingPlugin(data, plugins)
    } else {
      const ext = refs?.[n.type]
      if (ext?.extensionId) {
        data.extensionId = ext.extensionId
        if (ext.pluginId) data.pluginId = ext.pluginId
      }
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
      ...EDGE_STYLE,
      data: { tags: tagsForPort(e.source, e.sourceHandle) ?? [] },
    })
  }

  scheduleReroute()
  emit('dirty')
  const added = patch.nodes.map((n) => n.id)
  if (added.length) void nextTick(() => fitView({ nodes: added, padding: 0.35, duration: 300 }))
}

/**
 * Complete an AI-added plugin node from the palette's action registry.
 *
 * The patch names the action by `pluginId` + `action` only (all the model can
 * know from the prompt); the extension row id, the form that action advertised
 * and any outbound ports are stamped from the matching registry entry — the same
 * self-contained identity a palette drag gives it (see addNode). An action that
 * isn't found (a stale or invented reference) is left as-is; planPatch has
 * already flagged a plugin node missing its identity for review.
 */
function stampPluginRef(data: Record<string, unknown>, actions: PluginActionEntry[]): void {
  const pluginId = String(data.pluginId ?? '').trim()
  const action = String(data.action ?? '').trim()
  // Clear any incoming identity BEFORE resolving. A plugin node compiles its NATS
  // subject straight from `data.pluginId` (backend pluginUniqId), so a foreign or
  // stale id that survives to compile publishes to a subject nothing answers on —
  // a silent "no responders" at run time. Better to leave the node visibly
  // unbound (and flagged in review) than to let a wrong address masquerade as
  // configured. It is re-set only when a local plugin actually provides the action.
  delete data.extensionId
  delete data.pluginId
  delete data.form
  delete data.outbound
  if (!action) return
  // Match on the action method — the key that survives across installs (a
  // pluginId is a per-install address). Prefer the exact pair when the incoming
  // pluginId also names a local row (a same-install re-import or an AI patch);
  // otherwise any local plugin exposing this method resolves it.
  const hit =
    (pluginId && actions.find((a) => a.pluginId === pluginId && a.action === action)) ||
    actions.find((a) => a.action === action)
  if (!hit) return
  data.extensionId = hit.ref.extensionId
  data.pluginId = hit.ref.pluginId
  data.action = hit.action
  if (!String(data.title ?? '').trim()) data.title = hit.label
  if (hit.ref.form) data.form = hit.ref.form
  if (hit.ref.outbound?.length) data.outbound = hit.ref.outbound
  delete data.missingPlugin // resolved — drop the unrecognized marker
}

/**
 * Mark a plugin node whose action no local plugin provides as "unrecognized",
 * carrying the name and repo the file's manifest recorded for it (matched by the
 * node's action). The marker survives a save, so the node's drawer can offer the
 * repo to install — or a pick of an installed plugin — long after the import
 * dialog is gone. Falls back to the action's namespace for a name, and to no
 * repo, when the file carried no manifest (an older export or a bare patch).
 */
function markMissingPlugin(data: Record<string, unknown>, plugins: PluginManifestEntry[]): void {
  const action = String(data.action ?? '').trim()
  if (!action) return
  const entry = plugins.find((p) => p.actions.includes(action))
  const marker: MissingPlugin = {
    name: entry?.name || namespaceOf(action) || 'plugin',
    repo: entry?.repo,
    ref: entry?.ref,
    subdir: entry?.subdir,
  }
  data.missingPlugin = marker
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
  // Re-lay, then re-route the edges around the freshly placed nodes so the tidy
  // graph comes out with clean orthogonal edges instead of the pre-arrange ones.
  void nextTick(() => {
    scheduleReroute()
    fitView({ padding: 0.2, duration: 400 })
  })
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

// ---- Orthogonal edge routing ----------------------------------------------
// Edge paths are computed here, not by Vue Flow: the obstacle-avoiding router
// (lib/edgeRouting) needs *all* the node rectangles to route one edge around
// them, so the whole set is routed in a single pass and shared with the
// RoutedEdge components through this provided map. It is refreshed on every
// trigger that moves a node or changes the wiring, coalesced to one pass per
// animation frame so dragging a node stays smooth.
const routedPaths = ref<Map<string, RoutedPath>>(new Map())
provide(ROUTED_PATHS, routedPaths)

// The action methods this install's plugins expose, shared with every node so it
// can badge itself "unrecognized" the moment it holds an action nothing local
// provides (see FlowNode). `null` until first load, so nodes don't flash the
// badge before the set is known. Refreshed after an import or a plugin install.
const installedActions = ref<Set<string> | null>(null)
provide(INSTALLED_PLUGIN_ACTIONS, installedActions)
async function refreshInstalledActions(force = false): Promise<Set<string>> {
  const rows = await fetchPluginActions(force).catch(() => [] as PluginActionEntry[])
  const set = new Set(rows.map((r) => r.action))
  installedActions.value = set
  return set
}
onMounted(() => void refreshInstalledActions())

// Past this many nodes the search is skipped and edges fall back to smoothstep:
// the routing lattice grows with the node count, and a graph that large is past
// the point where routed edges are worth the per-frame cost.
const MAX_ROUTED_NODES = 120

let rerouteHandle = 0
function scheduleReroute() {
  if (rerouteHandle) cancelAnimationFrame(rerouteHandle)
  rerouteHandle = requestAnimationFrame(() => {
    rerouteHandle = 0
    recomputeRoutes()
  })
}

function sideOf(position: Position): Side {
  switch (position) {
    case Position.Left:
      return 'left'
    case Position.Top:
      return 'top'
    case Position.Bottom:
      return 'bottom'
    default:
      return 'right'
  }
}

/** Absolute port anchor + which side of its node it sits on, from measured bounds. */
function anchorOf(
  node: GraphNode,
  handleId: string | null | undefined,
  kind: 'source' | 'target',
): { point: { x: number; y: number }; side: Side } | null {
  const list = kind === 'source' ? node.handleBounds.source : node.handleBounds.target
  if (!list || list.length === 0) return null
  const h = (handleId ? list.find((x) => x.id === handleId) : null) ?? list[0]
  const pos = node.computedPosition
  return {
    point: { x: pos.x + h.x + h.width / 2, y: pos.y + h.y + h.height / 2 },
    side: sideOf(h.position),
  }
}

/** The two port anchors an edge connects, or null when either end isn't ready. */
function edgeRequest(edge: {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}): RouteRequest | null {
  const sn = findNode(edge.source)
  const tn = findNode(edge.target)
  if (!sn || !tn) return null
  const s = anchorOf(sn, edge.sourceHandle, 'source')
  const t = anchorOf(tn, edge.targetHandle, 'target')
  if (!s || !t) return null
  return { source: s.point, sourceSide: s.side, target: t.point, targetSide: t.side }
}

/** Route every edge around the current node rectangles, in one shared pass. */
function recomputeRoutes() {
  const graphNodes = getNodes.value
  const measured = graphNodes.filter((n) => n.dimensions?.width && n.dimensions?.height)
  const next = new Map<string, RoutedPath>()
  if (measured.length > 0 && measured.length <= MAX_ROUTED_NODES) {
    const obstacles: Rect[] = measured.map((n) => ({
      x: n.computedPosition.x,
      y: n.computedPosition.y,
      width: n.dimensions.width,
      height: n.dimensions.height,
    }))
    for (const e of edges.value) {
      const req = edgeRequest(e)
      if (!req) continue
      const pts = routeEdge(req, obstacles, DEFAULT_ROUTE_OPTIONS)
      if (!pts || pts.length < 2) continue
      const mid = midpoint(pts)
      next.set(e.id, { path: roundedPath(pts, 8), labelX: mid.x, labelY: mid.y })
    }
  }
  // Edges with no route (unmeasured, overlapping, or over the cap) are absent
  // from the map and the RoutedEdge component falls back to smoothstep for them.
  routedPaths.value = next
}

// First measure of the nodes: route once the DOM has given them real sizes.
onNodesInitialized(() => scheduleReroute())

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
  scheduleReroute()
  emit('select', null)
  emit('dirty')
}

/**
 * Re-bind every plugin node against the current registry — the cascade a node's
 * drawer triggers after a plugin is installed or picked. One node was resolved by
 * hand, but the fix is the plugin, so every node calling that plugin's actions is
 * re-stamped in one pass: the live action set is refreshed (so badges clear) and
 * each plugin node is run back through stampPluginRef, which now finds the local
 * row and stamps its extensionId/pluginId/form. Nodes whose plugin is still
 * missing are left as-is (re-marked). Leaves the canvas dirty when anything moved.
 */
async function rebindPluginNodes(): Promise<void> {
  const pluginNodes = nodes.value.filter((n) => n.type === 'plugin')
  if (!pluginNodes.length) return
  await refreshInstalledActions(true)
  const actions = await fetchPluginActions().catch(() => [] as PluginActionEntry[])
  const manifest: PluginManifestEntry[] = []
  let changed = false
  for (const n of pluginNodes) {
    const data = n.data as Record<string, unknown>
    const before = String(data.extensionId ?? '')
    stampPluginRef(data, actions)
    // Still unresolved and never marked — give it a namespace-only marker; an
    // existing marker (with the file's repo) is left intact by stampPluginRef.
    if (!data.extensionId && !data.missingPlugin) markMissingPlugin(data, manifest)
    if (String(data.extensionId ?? '') !== before) changed = true
  }
  if (changed) {
    scheduleReroute()
    emit('dirty')
  }
}

defineExpose({
  addNode,
  loadGraph,
  getGraph,
  applyPatch,
  rebindPluginNodes,
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
    <VueFlow v-model:nodes="nodes" v-model:edges="edges" :node-types="nodeTypes" :edge-types="edgeTypes" :edges-updatable="true"
      :delete-key-code="['Delete', 'Backspace']" :default-viewport="{ zoom: 1 }" :min-zoom="0.2" :max-zoom="2.5"
      :connection-line-type="ConnectionLineType.SmoothStep"
      :elevate-edges-on-select="true" :elevate-nodes-on-select="true"
      class="h-full w-full" @nodes-change="emit('dirty')" @edges-change="emit('dirty')">
      <Background :gap="18" :size="1.4" pattern-color="var(--canvas-dots)" />
      <Controls position="bottom-right" />
      <MiniMap v-if="showMinimap" pannable zoomable />
    </VueFlow>

    <NodePalette @add="onPaletteAdd" />
  </div>
</template>
