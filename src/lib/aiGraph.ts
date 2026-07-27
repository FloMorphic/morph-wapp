/**
 * The AI ⇄ canvas contract — a *graph patch*: the small JSON document an
 * assistant emits to describe nodes and wiring to add to the workflow canvas.
 *
 * This module is the whole front-side half of the "design with AI" story and is
 * deliberately self-contained:
 *
 *   1. {@link buildDesignerPrompt} generates the instructions an LLM needs to
 *      emit a valid patch — the node catalog, each kind's data fields, the port
 *      rules and the graph already on the canvas. It is *derived from
 *      NODE_SPECS*, so adding a node kind teaches the assistant about it for
 *      free and the prompt can never drift from the catalog.
 *   2. {@link parseAiGraph} pulls the patch out of whatever the model returned
 *      (fenced code block, prose around JSON, bare object).
 *   3. {@link planPatch} turns it into real canvas nodes and edges: kinds
 *      validated against the catalog, `data` merged over the spec's defaults,
 *      model-invented refs remapped to canvas ids, named ports resolved to
 *      handle ids, positions laid out, and every problem reported for review
 *      *before* anything touches the graph.
 *
 * Nothing here talks to a model or to the backend. The patch is a plain value,
 * so it works the same whether it came from a chat panel, a paste box, or (once
 * there is an MCP server over the designer) a tool call. Run-time state —
 * processes, live context JSON — is out of scope by design: a patch describes a
 * diagram and its configured values, never a run.
 */

import {
  NODE_SPECS,
  handlerTags,
  specForType,
  type BaseNodeData,
  type NodeKind,
  type NodePort,
  type NodeSpec,
} from '@/data/nodeCatalog'
import { createId } from '@/lib/id'
import { layeredLayout } from '@/lib/graphLayout'
import type { FlowNode, VueFlowGraph } from '@/types/api'

/* ------------------------------------------------------------------ contract */

/** One node an assistant asks for. `ref` is its handle *within the patch*. */
export interface AiNodeSpec {
  /** Local name the patch's edges refer to (e.g. "classify"). Not the canvas id. */
  ref: string
  /** Morphic type from the catalog — must be a {@link NodeKind}. */
  kind: NodeKind
  title?: string
  /** Where the node output is written into the Context. */
  key?: string
  /** JSONPath slice of Context the node reads / writes. */
  scope?: string
  /** Optional explicit placement; auto-laid-out when omitted. */
  position?: { x: number; y: number }
  /** Kind-specific fields, merged over the catalog defaults. */
  data?: Record<string, unknown>
  /** Why this node is here — surfaced in the review list, never saved. */
  note?: string
}

/** One connection. Endpoints are patch refs or ids of nodes already on canvas. */
export interface AiEdgeSpec {
  from: string
  to: string
  /**
   * Which output port of `from` to leave through, named the way a designer sees
   * it: an LLM function `name`, a Rule handler tag, or `_exception`. Required
   * when the source node has derived ports, meaningless otherwise.
   */
  port?: string
  note?: string
}

export interface AiGraphPatch {
  nodes: AiNodeSpec[]
  edges?: AiEdgeSpec[]
  /** Free-text remarks from the assistant (assumptions, what to fill in). */
  notes?: string[]
}

/* -------------------------------------------------------------- planned form */

export interface PatchProblem {
  /** `error` ⇒ the offending node/edge is dropped; `warn` ⇒ applied as-is. */
  level: 'error' | 'warn'
  message: string
  /** The patch ref / edge the problem is about, for the review list. */
  at?: string
}

/** A node ready to push onto the canvas — real id, merged data, placed. */
export interface PlannedNode {
  id: string
  type: NodeKind
  position: { x: number; y: number }
  data: BaseNodeData
  /** The patch ref this came from (review list only). */
  ref: string
  spec: NodeSpec
  note?: string
}

export interface PlannedEdge {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  /** Human label of the resolved port, for the review list. */
  portLabel?: string
}

export interface PlannedPatch {
  nodes: PlannedNode[]
  edges: PlannedEdge[]
  problems: PatchProblem[]
  notes: string[]
}

export const hasErrors = (p: PlannedPatch): boolean => p.problems.some((x) => x.level === 'error')

/* -------------------------------------------------------------------- parsing */

export interface ParseResult {
  patch: AiGraphPatch | null
  error: string | null
}

/**
 * Extract a patch from raw assistant output. Tolerates a ```json fence, prose
 * before or after the object, and a bare array of nodes; rejects anything that
 * isn't ultimately an object with a `nodes` array.
 */
export function parseAiGraph(raw: string): ParseResult {
  const text = (raw ?? '').trim()
  if (!text) return { patch: null, error: null }

  const body = stripFence(text)
  const json = body.startsWith('{') || body.startsWith('[') ? body : sliceFirstObject(body)
  if (!json) return { patch: null, error: 'No JSON object found in that text.' }

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (err) {
    return { patch: null, error: `Invalid JSON — ${(err as Error).message}` }
  }

  // A bare array is read as the node list, which is what models tend to emit
  // when the goal needs no wiring.
  const obj = Array.isArray(value) ? { nodes: value } : (value as Record<string, unknown>)
  if (!obj || typeof obj !== 'object') return { patch: null, error: 'Expected a JSON object.' }
  if (!Array.isArray(obj.nodes)) return { patch: null, error: 'Missing a "nodes" array.' }

  return {
    patch: {
      nodes: obj.nodes.filter((n) => n && typeof n === 'object') as AiNodeSpec[],
      edges: Array.isArray(obj.edges) ? (obj.edges.filter((e) => e && typeof e === 'object') as AiEdgeSpec[]) : [],
      notes: Array.isArray(obj.notes) ? obj.notes.map(String) : [],
    },
    error: null,
  }
}

function stripFence(text: string): string {
  const fence = text.match(/```(?:json|jsonc)?\s*([\s\S]*?)```/i)
  return fence ? fence[1].trim() : text
}

/** First balanced `{…}` region, ignoring braces inside strings. */
function sliceFirstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/* ------------------------------------------------------------------- planning */

/** Clearance between the graph already on the canvas and a patch dropped beside it. */
const PATCH_GAP = 320

/**
 * Validate a patch against the catalog and turn it into canvas nodes / edges.
 *
 * `existing` is the graph currently on the canvas: new nodes are laid out clear
 * of it, and an edge may name one of its node ids to attach the new subgraph to
 * what is already there. It is never mutated — planning is pure, so a caller can
 * plan on every keystroke to preview the result.
 */
export function planPatch(patch: AiGraphPatch, existing?: VueFlowGraph | null): PlannedPatch {
  const problems: PatchProblem[] = []
  const existingNodes = existing?.nodes ?? []
  const existingIds = new Set(existingNodes.map((n) => n.id))

  // ---- nodes ----
  const planned: PlannedNode[] = []
  const idByRef = new Map<string, string>()

  patch.nodes.forEach((raw, i) => {
    const ref = String(raw.ref ?? '').trim() || `node${i + 1}`
    if (idByRef.has(ref)) {
      problems.push({ level: 'error', at: ref, message: `Duplicate ref "${ref}" — only the first is added.` })
      return
    }
    const spec = specForType(String(raw.kind ?? ''))
    if (!spec) {
      problems.push({
        level: 'error',
        at: ref,
        message: `Unknown node kind "${String(raw.kind)}". Valid kinds: ${Object.keys(NODE_SPECS).join(', ')}.`,
      })
      return
    }

    const data = mergeData(spec, raw)
    const id = createId('n')
    idByRef.set(ref, id)
    // An explicit position is honoured as-is; {0,0} marks "lay this one out".
    const p = raw.position
    const position = p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : { x: 0, y: 0 }
    planned.push({ id, type: spec.type, position, data, ref, spec, note: raw.note })
    problems.push(...inspectNode(spec, data, ref))
  })

  const startCount =
    existingNodes.filter((n) => n.type === 'startNode').length + planned.filter((n) => n.type === 'startNode').length
  if (startCount > 1) {
    problems.push({
      level: 'warn',
      message: `The flow would have ${startCount} Start nodes — a flow requires exactly one. Delete the extras.`,
    })
  }

  // ---- edges ----
  const plannedById = new Map(planned.map((n) => [n.id, n]))
  const edges: PlannedEdge[] = []

  for (const raw of patch.edges ?? []) {
    const label = `${String(raw.from)} → ${String(raw.to)}`
    const source = resolveEndpoint(raw.from, idByRef, existingIds)
    const target = resolveEndpoint(raw.to, idByRef, existingIds)
    if (!source || !target) {
      problems.push({
        level: 'error',
        at: label,
        message: `Edge dropped — ${!source ? `"${String(raw.from)}"` : `"${String(raw.to)}"`} is not a node in this patch or on the canvas.`,
      })
      continue
    }

    const port = resolvePort(source, raw.port, plannedById, existingNodes)
    if (port.problem) problems.push({ ...port.problem, at: label })
    if (port.drop) continue

    edges.push({
      id: createId('e'),
      source,
      target,
      sourceHandle: port.handleId ?? null,
      targetHandle: null,
      portLabel: port.label,
    })
  }

  layout(planned, edges, existingNodes)

  return { nodes: planned, edges, problems, notes: patch.notes ?? [] }
}

/** Catalog defaults, then the patch's own fields on top. */
function mergeData(spec: NodeSpec, raw: AiNodeSpec): BaseNodeData {
  const data = { ...spec.defaults(), ...(raw.data ?? {}) } as BaseNodeData
  if (raw.title !== undefined) data.title = String(raw.title)
  if (raw.key !== undefined) data.key = String(raw.key)
  if (raw.scope !== undefined) data.scope = String(raw.scope)

  // Prompt shorthand. Models reliably emit `system` / `prompt` strings but get
  // the nested `body.messages` array wrong, so accept both and normalise to the
  // one shape the drawer and the plugin read (see NodeConfig's messages()).
  if (spec.kind === 'llm' || spec.kind === 'mcp') {
    const shorthand = pickMessages(data)
    if (shorthand) data.body = { ...(asObject(data.body) ?? {}), messages: shorthand }
    delete data.system
    delete data.prompt
    delete data.messages
  }

  // Ports fall back to the function name / handler index for their handle id
  // when no `id` is set, which would make the id move the moment someone renames
  // the function in the drawer — and every edge already drawn from that port
  // would point at a handle that no longer exists. The drawer stamps an id on
  // anything it creates, so do the same here.
  if (spec.kind === 'llm') data.functions = stampIds(data.functions, 'fn')
  // A handler names its branch; `tags` is the field the engine and the compiler
  // read, so derive it here rather than trusting the model to write both.
  if (spec.kind === 'rule')
    data.handlers = stampIds(data.handlers, 'h').map((h) => ({ ...h, tags: handlerTags(h) }))
  return data
}

/** Give every row a stable `id`, leaving any the patch already supplied. */
function stampIds(value: unknown, prefix: string): Record<string, unknown>[] {
  return asRows(value).map((row, i) => ({
    ...row,
    id: String(row.id ?? '').trim() || `${prefix}-${createId()}-${i}`,
  }))
}

/** The init messages implied by a node's data, or undefined to leave `body` be. */
function pickMessages(data: BaseNodeData): { role: string; content: string }[] | undefined {
  const body = asObject(data.body)
  const fromBody = Array.isArray(body?.messages) ? (body.messages as unknown[]) : undefined
  const raw = Array.isArray(data.messages) ? (data.messages as unknown[]) : fromBody
  const rows: { role: string; content: string }[] = []

  const system = typeof data.system === 'string' ? data.system : undefined
  const user = typeof data.prompt === 'string' ? data.prompt : undefined
  if (system?.trim()) rows.push({ role: 'system', content: system })
  if (user?.trim()) rows.push({ role: 'user', content: user })

  for (const m of raw ?? []) {
    const msg = asObject(m)
    const role = String(msg?.role ?? '') === 'system' ? 'system' : 'user'
    const content = typeof msg?.content === 'string' ? msg.content : ''
    if (content.trim() && !rows.some((r) => r.role === role)) rows.push({ role, content })
  }
  if (rows.length === 0) return raw ? [] : undefined
  // The drawer edits exactly one system and one user box, in that order.
  return rows.sort((a, b) => (a.role === 'system' ? 0 : 1) - (b.role === 'system' ? 0 : 1))
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function asRows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []
}

/**
 * Per-kind sanity checks. These are the mistakes that make a *valid-looking*
 * node fail at run time — an LLM function the model can never pick, a rule with
 * no body, a plugin node with no settings profile — so they are reported for
 * review rather than silently applied.
 */
function inspectNode(spec: NodeSpec, data: BaseNodeData, at: string): PatchProblem[] {
  const out: PatchProblem[] = []

  // MCP in tool mode drives no model — it calls one named tool — so the
  // provider/model wording would be actively misleading there.
  const toolOnlyMcp = spec.kind === 'mcp' && String(data.mcpMode ?? 'tool') === 'tool'
  if (spec.plugin && !toolOnlyMcp) {
    out.push({
      level: 'warn',
      at,
      message: `${spec.label} needs a settings profile (provider / model) before it can run — pick one in the node drawer.`,
    })
  }
  if (toolOnlyMcp) {
    out.push({
      level: 'warn',
      at,
      message: 'MCP in tool mode calls one named tool — load the server\'s tools in the node drawer and check the selected tool and its arguments.',
    })
    if (!String(data.tool ?? '').trim()) {
      out.push({ level: 'warn', at, message: 'No tool selected, so there is nothing for this node to call.' })
    }
  }

  if (spec.kind === 'llm') {
    const fns = asRows(data.functions)
    fns.forEach((f, i) => {
      const name = String(f.name ?? '').trim()
      const where = `${at} · function ${name || i + 1}`
      if (!name) out.push({ level: 'error', at: where, message: 'Function has no `name` — its port would carry no route tag, so nothing downstream would ever run.' })
      if (!String(f.description ?? '').trim()) out.push({ level: 'warn', at: where, message: 'Function has no `description` — the model picks tools by their description.' })
    })
    if (fns.length === 0 && !messageText(data)) {
      out.push({ level: 'warn', at, message: 'LLM node has neither init messages nor bound functions — it would call the model with an empty prompt.' })
    }
  }

  if (spec.kind === 'rule') {
    if (asRows(data.handlers).length === 0) out.push({ level: 'warn', at, message: 'Rule has no handlers, so it has no routed branches.' })
  }

  if (spec.kind === 'rule' || spec.kind === 'js' || spec.kind === 'opa') {
    const code = String(data.logic_rule ?? '')
    if (!code.trim()) out.push({ level: 'error', at, message: 'Missing `logic_rule` — there is no code to evaluate.' })
    else if (String(data.lang ?? 'js') === 'js') out.push(...inspectJsCode(code, at))
    // Rego, whichever kind it is on — a Rule can be switched to `lang: "opa"`.
    else if (!String(data.opa_result ?? '').trim()) {
      out.push({ level: 'warn', at, message: 'No result variable set — nothing tells the policy which Rego variable to emit as the node output.' })
    }
  }

  if (spec.kind === 'mcp' && !String(data.url ?? '').trim()) {
    out.push({ level: 'warn', at, message: 'MCP node has no server URL yet.' })
  }

  if ((spec.kind === 'docstore' || spec.kind === 'vecstore') && !String(data.storeId ?? '').trim()) {
    out.push({ level: 'warn', at, message: `${spec.label} has no store selected — pick one in the node drawer.` })
  }

  return out
}

/**
 * The two ways a model reliably gets FloMorphic's JS evaluation model wrong.
 *
 * The runtime evaluates the code and takes the value of its LAST EXPRESSION as
 * the node output, with the scoped slice bound to `input` — there is no function
 * wrapper to return from and no `ctx`. Both mistakes produce a node that looks
 * right in the drawer and emits nothing, so they are worth naming here rather
 * than leaving to a puzzled first run.
 *
 * Checked narrowly to stay quiet on correct code: only a trailing `return`
 * statement (the actual mistake — `return` inside a callback is fine), and only
 * a `ctx.` property read that nothing in the code declares.
 */
function inspectJsCode(code: string, at: string): PatchProblem[] {
  const out: PatchProblem[] = []
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
  const last = lines[lines.length - 1] ?? ''

  if (/^return\b/.test(last)) {
    out.push({
      level: 'warn',
      at,
      message: 'Code ends in a `return` statement. There is no function to return from — the value of the last expression is the output, so drop the `return` and leave the value on its own line.',
    })
  }
  if (/\bctx\s*\./.test(code) && !/\b(?:let|const|var|function)\s+ctx\b/.test(code)) {
    out.push({
      level: 'warn',
      at,
      message: 'Code reads `ctx`, which is not defined. The scoped slice is bound to `input`.',
    })
  }
  return out
}

function messageText(data: BaseNodeData): string {
  const msgs = asObject(data.body)?.messages
  return asRows(msgs)
    .map((m) => String(m.content ?? ''))
    .join('')
    .trim()
}

function resolveEndpoint(raw: unknown, idByRef: Map<string, string>, existingIds: Set<string>): string | null {
  const key = String(raw ?? '').trim()
  if (!key) return null
  return idByRef.get(key) ?? (existingIds.has(key) ? key : null)
}

/**
 * Resolve a port named the way a designer sees it to the handle id an edge has
 * to leave from. Matches (in order) the port's handle id, its route tag, and its
 * label — so "lookup", the function's name, and its display title all work.
 *
 * A node whose ports are derived has *no* default handle, so an unmatched or
 * missing port name would leave the edge attached to nothing: that drops the
 * edge with the available ports listed, rather than adding a dead connection.
 */
function resolvePort(
  sourceId: string,
  requested: string | undefined,
  planned: Map<string, PlannedNode>,
  existingNodes: FlowNode[],
): { handleId?: string; label?: string; drop?: boolean; problem?: PatchProblem } {
  const node = planned.get(sourceId)
  const found = node
    ? { type: node.type as string, data: node.data as unknown }
    : existingNodes.find((n) => n.id === sourceId)
  if (!found) return {}

  const spec = specForType(String(found.type ?? ''))
  const ports: NodePort[] = spec?.ports?.(found.data as BaseNodeData) ?? []
  const want = String(requested ?? '').trim()

  if (ports.length === 0) {
    if (want) {
      return {
        problem: {
          level: 'warn',
          message: `Source has no named ports — "${want}" ignored and the edge left on its default handle.`,
        },
      }
    }
    return {}
  }

  if (!want) {
    return {
      drop: true,
      problem: {
        level: 'error',
        message: `Edge dropped — the source routes through named ports, so "port" is required. Available: ${portNames(ports)}.`,
      },
    }
  }

  const hit =
    ports.find((p) => p.id === want) ??
    ports.find((p) => p.tags?.includes(want)) ??
    ports.find((p) => p.label.toLowerCase() === want.toLowerCase())
  if (!hit) {
    return {
      drop: true,
      problem: {
        level: 'error',
        message: `Edge dropped — no port "${want}" on the source. Available: ${portNames(ports)}.`,
      },
    }
  }
  return { handleId: hit.id, label: hit.label }
}

/**
 * How the available ports are offered back when an edge names one that doesn't
 * exist. The route tag first — that is the string a patch is expected to use —
 * then the label, so a port with no tag yet (a function still missing its name)
 * is described by something a designer recognises rather than its internal id.
 */
function portNames(ports: NodePort[]): string {
  return ports.map((p) => p.tags?.[0] || p.label || p.id).join(', ')
}

/**
 * Place the new nodes: explicit positions win, the rest go through the shared
 * layered layout ({@link layeredLayout} — columns by hop count, rows ordered to
 * cut edge crossings), anchored clear of whatever is already on the canvas so
 * nothing lands on top of an existing node.
 *
 * Nothing is rendered yet at this point, so node heights are estimated from the
 * catalog rather than measured — see {@link estimateHeight}.
 */
function layout(nodes: PlannedNode[], edges: PlannedEdge[], existing: FlowNode[]): void {
  const auto = nodes.filter((n) => !n.position.x && !n.position.y)
  if (auto.length === 0) return

  const originX = existing.length ? Math.max(...existing.map((n) => n.position?.x ?? 0)) + PATCH_GAP : 120
  const originY = existing.length ? Math.min(...existing.map((n) => n.position?.y ?? 0)) : 120

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const placements = layeredLayout(
    auto.map((n) => ({ id: n.id, height: estimateHeight(n.spec, n.data) })),
    edges.map((e) => ({ source: e.source, target: e.target, rank: portRank(byId.get(e.source), e.sourceHandle) })),
    { originX, originY },
  )

  for (const n of auto) {
    const p = placements.get(n.id)
    if (p) n.position = p
  }
}

/** Where a port sits on its node, so a fan of branches keeps the ports' order. */
function portRank(node: PlannedNode | undefined, handleId: string | null): number {
  if (!node || !handleId) return 0
  const i = node.spec.ports?.(node.data)?.findIndex((p) => p.id === handleId) ?? -1
  return i < 0 ? 0 : i
}

/**
 * Roughly how tall a node will render (see FlowNode.vue): header + footer, plus
 * a card per port when the ports stack down the side, or one label strip when
 * they sit along the bottom edge. Only has to be close — it decides how much
 * vertical room the layout leaves around the node, and an LLM with a dozen
 * bound functions is several times the height of a bare one.
 */
function estimateHeight(spec: NodeSpec, data: BaseNodeData): number {
  const ports = spec.ports?.(data)?.length ?? 0
  const base = 72
  if (ports === 0) return base
  return spec.portLayout === 'stack' ? base + ports * 28 : base + 20
}

/* ------------------------------------------------------------------ lowering */

/**
 * The canvas graph *back* into a patch — the inverse of {@link planPatch}, and
 * the document the Export button writes.
 *
 * The patch is the readable form of a workflow, so it is the one worth handing
 * to a person or a model: designer-named refs instead of generated ids, ports
 * named the way the prompt teaches them (an LLM function's name, a Rule
 * handler's tag, `_exception`), and only the `data` a node actually *changed* —
 * everything equal to its catalog default is left out, because planPatch merges
 * the defaults back in on the way in. That is what keeps the file short enough
 * to read, and it round-trips: what comes out of here goes straight back
 * through parseAiGraph / planPatch.
 *
 * Two things are deliberately dropped. Canvas ids and handle ids, because they
 * are regenerated on import and mean nothing outside the graph that made them;
 * and the extension identity (`extensionId` / `pluginId`), because those name
 * rows in *one* install's extension table — applyPatch re-stamps them from the
 * local table, which is exactly what makes the file portable. Settings profile
 * ids are kept: they are a choice the designer made, and a file carried to
 * another install reports them as something to re-pick (see inspectNode).
 */
export function graphToPatch(graph: VueFlowGraph): AiGraphPatch {
  const refById = new Map<string, string>()
  const taken = new Set<string>()

  const nodes: AiNodeSpec[] = (graph.nodes ?? []).map((n, i) => {
    const spec = specForType(String(n.type ?? ''))
    const data = asObject(n.data) ?? {}
    const defaults = (spec?.defaults() ?? {}) as Record<string, unknown>
    const title = str(data.title)

    const ref = uniqueRef(title || spec?.label || String(n.type ?? `node${i + 1}`), taken)
    refById.set(n.id, ref)

    const out: AiNodeSpec = { ref, kind: n.type as NodeKind }
    if (title) out.title = title
    // key / scope are hoisted out of `data` like the patch shape wants, but only
    // when they say something the catalog default doesn't.
    if (str(data.key) && data.key !== defaults.key) out.key = str(data.key)
    if (str(data.scope) && data.scope !== defaults.scope) out.scope = str(data.scope)
    if (n.position) out.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) }

    const custom = changedData(data, defaults)
    if (Object.keys(custom).length) out.data = custom
    return out
  })

  const edges: AiEdgeSpec[] = []
  for (const e of graph.edges ?? []) {
    const from = refById.get(e.source)
    const to = refById.get(e.target)
    // An edge whose endpoints are not both in this graph has nothing to name it
    // by; it cannot exist in a saved flow, so there is nothing to report.
    if (!from || !to) continue
    const edge: AiEdgeSpec = { from, to }
    const port = portName(graph.nodes.find((n) => n.id === e.source), e.sourceHandle)
    if (port) edge.port = port
    edges.push(edge)
  }

  return { nodes, edges }
}

/** Node data minus the hoisted fields, the install-local identity and anything left at its default. */
function changedData(data: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(['title', 'key', 'scope', 'extensionId', 'pluginId'])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(k) || v === undefined) continue
    if (JSON.stringify(v) === JSON.stringify(defaults[k])) continue
    out[k] = v
  }
  return out
}

/** What a designer calls the port an edge leaves through — the name resolvePort reads back. */
function portName(node: FlowNode | undefined, handleId?: string | null): string | undefined {
  if (!node || !handleId) return undefined
  const ports = specForType(String(node.type ?? ''))?.ports?.(node.data as BaseNodeData) ?? []
  const hit = ports.find((p) => p.id === handleId)
  if (!hit) return undefined
  return hit.tags?.[0] || hit.label || hit.id
}

/** A node's title as a short, unique, readable patch ref (`classify`, `classify-2`). */
function uniqueRef(source: string, taken: Set<string>): string {
  const base =
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '') || 'node'
  let ref = base
  for (let i = 2; taken.has(ref); i++) ref = `${base}-${i}`
  taken.add(ref)
  return ref
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/* --------------------------------------------------------------- the prompt */

/**
 * The instructions an assistant needs to emit a patch for *this* catalog and
 * *this* canvas. Generated from NODE_SPECS (kinds, taglines, the exact `data`
 * fields each kind carries and their defaults) so it stays true as the catalog
 * grows, plus a summary of the graph on screen so the model can wire into it.
 *
 * Used two ways: pasted into any chat by hand today, and handed to the built-in
 * assistant as its system prompt once one is wired up.
 */
export function buildDesignerPrompt(goal: string, existing?: VueFlowGraph | null): string {
  const nodes = existing?.nodes ?? []
  const lines: string[] = []

  lines.push(
    'You are a workflow designer for FloMorphic — a contract-driven runtime where a workflow is a graph of typed nodes over a shared JSON Context.',
    '',
    'Reply with ONE JSON object and nothing else. No prose, no code fence.',
    '',
    '## Output shape',
    '```json',
    JSON.stringify(
      {
        nodes: [
          { ref: 'local-name', kind: 'llm', title: 'Classify ticket', key: 'messages', scope: '$', data: {}, note: 'why this node exists' },
        ],
        edges: [{ from: 'local-name', to: 'other-ref', port: 'escalate', note: 'when the model calls escalate' }],
        notes: ['anything the designer must fill in by hand'],
      },
      null,
      2,
    ),
    '```',
    '',
    '- `ref` is a short local name you invent; `edges` refer to nodes by `ref`. Real canvas ids are assigned on import.',
    '- Every node carries `title` (label), `key` (where its output is written into the Context) and `scope` (the JSONPath slice it reads/writes, usually `$`).',
    '',
    '## Scope — and the loop it hides',
    '`scope` is a full JSONPath: dotted paths, wildcards, expressions and filter queries all work.',
    'Its cardinality decides how many times the node runs. A scope selecting ONE value runs the node once against it.',
    'A scope selecting MANY (`$.orders[*]`, `$.orders[?(@.total > 100)]`) makes the runtime run the node ONCE PER ELEMENT, each pass scoped to just that element.',
    'That is how you iterate a collection — there is no loop node. Use `$` when the node should see the whole context.',
    '',
    '## Writing code (`js` and `rule` nodes, and `opa`)',
    'The scoped slice arrives as `input`. There is no `ctx`, no arguments, no function wrapper.',
    'In JavaScript the value of the LAST EXPRESSION is the node output. Do NOT write `return` — end the code by naming the value to emit:',
    '```js',
    'let scopedData = input',
    'let result = { ok: scopedData.total > 0 }',
    'result',
    '```',
    'In Rego, `input` is the scoped slice and `data` holds the Conditions key/values; the node outputs the variable named by `opa_result` (set `opa_result: "x"` and the value of `x` is what the node emits).',
    '- `data` holds the kind-specific fields listed below. Omit a field to take its default. Never invent fields.',
    '- Reference Context values inside any text field with `{{$.path}}` (e.g. `{{$.ticket.body}}`) — resolved at run time.',
    '- Add `note` per node/edge to explain a decision. Put assumptions and anything needing manual setup in `notes`.',
    '',
    '## Wiring',
    '- A node with derived output ports (LLM with bound functions, Rule with handlers) has NO default handle: every edge leaving it MUST name a `port`.',
    '- For an LLM node, `port` is the bound function\'s `name` — the model calling that function is what routes the flow down that edge.',
    "- Every LLM node with functions also has an `_exception` port: use `port: \"_exception\"` for the branch that handles a plugin error or the model picking no function.",
    "- For a Rule node, `port` is the handler's `name` — the tag its branch fires.",
    '- Other kinds have a single unnamed output: omit `port`.',
    '- Fanning out to several nodes runs them in parallel. Put a `promissall` node in front of a step that must wait for all of them.',
    '',
    '## Node kinds',
  )

  for (const spec of Object.values(NODE_SPECS)) {
    const defaults = spec.defaults() as Record<string, unknown>
    const extra = Object.fromEntries(Object.entries(defaults).filter(([k]) => !['title', 'key', 'scope'].includes(k)))
    lines.push(
      '',
      `### ${spec.kind} — ${spec.label}`,
      `${spec.tagline}. ${spec.description}`,
      `Compiles to: ${spec.primitives}.`,
      Object.keys(extra).length
        ? `data fields (with defaults): ${JSON.stringify(extra)}`
        : 'data fields: none beyond title / key / scope.',
    )
    if (spec.kind === 'llm') {
      lines.push(
        'Init messages: use the shorthand `"system": "…"` and `"prompt": "…"` on `data` instead of writing body.messages by hand.',
        'Each bound function is `{ "name": "snake_case_tool_name", "title": "Label", "description": "when the model should call this", "parameters": { "type": "object", "properties": { … }, "required": [] } }`.',
        '`name` is both the tool name and the route tag, `description` is what the model chooses on (always write one), `parameters` is the JSON Schema of the call arguments (flat properties only).',
      )
    }
    if (spec.kind === 'mcp') {
      lines.push('Set `mcpMode` to "tool" (call one tool, `request: "call_tool"`) or "llm" (drive a model over the server\'s tools, `request: "run"`), and keep `request` in step. Tools are loaded from the server in the app, not written here.')
    }
    if (spec.kind === 'rule') {
      lines.push(
        'Handlers are `{ "id": "h1", "name": "approved", "title": "Approved" }`; each is a routed branch.',
        '`name` is the branch\'s route tag — the decision has to fire it and the edge leaving that port carries it — while `title` only labels the port on the canvas.',
        '`logic_rule` is JS returning a value (`lang: "js"`) or Rego (`lang: "opa"`).',
      )
    }
    if (spec.kind === 'hitl') {
      lines.push('`operationData` is the list of questions asked of the person.')
    }
  }

  lines.push('', '## Canvas', nodes.length ? 'Nodes already on the canvas — use these ids verbatim in `edges` to connect to them (do NOT re-create them):' : 'The canvas is empty. Include exactly one `startNode` as the entry point.')
  for (const n of nodes) {
    const title = String((n.data as Record<string, unknown>)?.title ?? '').trim()
    lines.push(`- ${n.id} · ${n.type}${title ? ` · "${title}"` : ''}`)
  }
  if (nodes.length && !nodes.some((n) => n.type === 'startNode')) {
    lines.push('There is no Start node yet — include one.')
  }

  lines.push('', '## Task', goal.trim() || '(describe the workflow to build)')
  return lines.join('\n')
}

/** A compact summary of what an applied patch changed, for the toast. */
export function summarize(planned: PlannedPatch): string {
  const n = planned.nodes.length
  const e = planned.edges.length
  return `Added ${n} node${n === 1 ? '' : 's'} and ${e} connection${e === 1 ? '' : 's'}`
}
