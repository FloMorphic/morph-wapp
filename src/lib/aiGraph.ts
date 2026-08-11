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
import type { PluginActionEntry } from '@/lib/nodeExtRefs'
import type { FlowEdge, FlowNode, VueFlowGraph } from '@/types/api'

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
 * Move a patch's own coordinate frame clear of a graph already on the canvas,
 * keeping the shape it was drawn in.
 *
 * {@link planPatch} lays out the nodes that ask to be laid out — the ones with
 * no position — but a patch that *does* carry positions is taken at its word,
 * and a whole workflow imported from a file carries every one of them. Merged
 * as-is it would land on top of the graph it was merged into, node for node.
 * Shifting the frame is the answer rather than dropping the positions: the
 * imported workflow keeps the layout it was exported with, just further right.
 *
 * Nodes without a position are left without one, so they still get laid out.
 */
export function offsetPatch(patch: AiGraphPatch, existing?: VueFlowGraph | null): AiGraphPatch {
  const existingNodes = existing?.nodes ?? []
  const placed = patch.nodes.filter((n) => n.position)
  if (existingNodes.length === 0 || placed.length === 0) return patch

  const dx =
    Math.max(...existingNodes.map((n) => n.position?.x ?? 0)) + PATCH_GAP - Math.min(...placed.map((n) => n.position!.x))
  const dy = Math.min(...existingNodes.map((n) => n.position?.y ?? 0)) - Math.min(...placed.map((n) => n.position!.y))

  return {
    ...patch,
    nodes: patch.nodes.map((n) =>
      n.position ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
    ),
  }
}

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

  problems.push(...inspectConvergence(planned, edges, existingNodes, existing?.edges ?? []))

  layout(planned, edges, existingNodes)

  return { nodes: planned, edges, problems, notes: patch.notes ?? [] }
}

/**
 * The wiring mistake no single node can see: two branches arriving at one node.
 *
 * Inbound edges do not merge. The runtime starts a task per edge it follows, so
 * a node with two inbound edges runs twice, in parallel — two branches meeting
 * at one "send report" node send two reports. Only `promissall` merges, by
 * waiting for its inbound nodes and then continuing once.
 *
 * The same shape is also what breaks a `promissall` downstream: a join waits for
 * its inbound nodes to reach the same round, so a doubly-run node feeding one
 * makes it wait for a round that never arrives and the run stalls until the
 * process times out. That is reported against the join, where the damage lands.
 *
 * Edges already on the canvas are counted too, since a patch wiring a second
 * branch into a node that already has one causes this just as readily — but only
 * nodes this patch actually wires into are reported, so planning a patch never
 * complains about a shape the designer built earlier and left alone.
 */
function inspectConvergence(
  planned: PlannedNode[],
  edges: PlannedEdge[],
  existing: FlowNode[],
  existingEdges: FlowEdge[],
): PatchProblem[] {
  const out: PatchProblem[] = []
  const nameById = new Map<string, { label: string; kind: string }>()
  for (const n of planned) nameById.set(n.id, { label: n.ref, kind: n.type as string })
  for (const n of existing) {
    const title = String((n.data as Record<string, unknown>)?.title ?? '').trim()
    nameById.set(n.id, { label: title || n.id, kind: String(n.type ?? '') })
  }

  const inboundCount = new Map<string, number>()
  for (const e of [...existingEdges, ...edges]) {
    inboundCount.set(e.target, (inboundCount.get(e.target) ?? 0) + 1)
  }
  // Only what this patch wires is worth reporting.
  const touched = new Set(edges.map((e) => e.target))

  const multi = new Set([...inboundCount].filter(([, n]) => n > 1).map(([id]) => id))

  for (const [id, count] of inboundCount) {
    const node = nameById.get(id)
    if (!node || node.kind === 'promissall' || !touched.has(id)) continue
    if (count > 1) {
      out.push({
        level: 'warn',
        at: node.label,
        message: `${count} branches arrive at "${node.label}", so it runs ${count} times — inbound edges do not merge. If you meant "when all of them are done", put a Wait for All (promissall) in front of it and wire the branches into that.`,
      })
    }
  }

  // A join fed by a node that itself runs several times can never be satisfied.
  for (const e of edges) {
    const target = nameById.get(e.target)
    if (target?.kind !== 'promissall') continue
    if (!multi.has(e.source)) continue
    const source = nameById.get(e.source)
    out.push({
      level: 'error',
      at: target.label,
      message: `"${target.label}" waits on "${source?.label ?? e.source}", which itself runs more than once. A Wait for All needs every branch it waits on to run the same number of times, or it waits forever and the run stalls until it times out.`,
    })
  }

  return out
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

  // An imported-plugin node is meaningless without the identity of the action it
  // calls — that pair is what applyPatch resolves to the extension row (and the
  // action's form). A model that emits one with either half missing has picked a
  // plugin that is not registered here; the node lands but cannot be configured.
  if (spec.kind === 'plugin') {
    const pluginId = String(data.pluginId ?? '').trim()
    const action = String(data.action ?? '').trim()
    if (!pluginId || !action) {
      out.push({
        level: 'error',
        at,
        message: 'Plugin node is missing `pluginId` and/or `action`. Use only a plugin action listed under "Plugins available" — copy both verbatim.',
      })
    }
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
  // `{{…}}` is substituted into text fields — a url, a prompt, a plugin input —
  // and never into code: the interpreter gets the source exactly as written. In
  // a string literal that yields the characters `{{$.x}}` as the value, which is
  // the worse case because the node succeeds and writes rubbish; anywhere else
  // it is a syntax error. Either way the code has to be rewritten around `_get`.
  if (/\{\{/.test(code)) {
    out.push({
      level: 'error',
      at,
      message: 'Code contains `{{…}}`, which is not substituted inside code — it stays literal text (or fails to parse). Read the Context with `_get("$.path")` instead.',
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
 * The "Plugins available" section — the imported-plugin actions registered in
 * this install, grouped by the plugin they came from, plus the one way to use
 * one: a `plugin` node stamped with the action's `pluginId` + `action`.
 *
 * Empty when nothing is imported, which is the honest signal — with no section
 * the model has no plugin to reach for and stays on the builtins. The list is
 * deliberately identity + description only: the action's own input fields (its
 * `body`) and its settings profile are filled in by the designer in the drawer
 * after import (applyPatch stamps the advertised form so those fields appear),
 * so the model is told to leave them and note it, not to guess them.
 */
function pluginPromptLines(plugins?: PluginActionEntry[]): string[] {
  if (!plugins?.length) return []
  const lines: string[] = [
    '',
    '## Plugins available',
    'These imported-plugin actions are registered in this install. Use one by adding a node with `kind: "plugin"` and `data: { "pluginId": "<id>", "action": "<action>" }` (copy both verbatim from the list), a `title`, and a `note`. Do NOT invent a plugin or an action that is not listed, and do NOT fill in the action\'s own input fields or a settings profile — the designer completes those in the drawer after import. A plugin node has a single output port; wire it like any other node.',
  ]

  // Group by plugin so the model sees "Jira · create_issue / add_comment" rather
  // than a flat list of methods from unrelated plugins.
  const byPlugin = new Map<string, { name: string; actions: PluginActionEntry[] }>()
  for (const p of plugins) {
    const g = byPlugin.get(p.pluginId) ?? { name: p.pluginName || p.pluginId, actions: [] }
    g.actions.push(p)
    byPlugin.set(p.pluginId, g)
  }

  for (const { name, actions } of byPlugin.values()) {
    lines.push('', `### ${name} (\`pluginId: "${actions[0].pluginId}"\`)`)
    for (const a of actions) {
      const desc = a.description?.trim()
      lines.push(`- \`action: "${a.action}"\` — ${a.label}${desc ? `: ${desc}` : ''}`)
    }
  }
  return lines
}

/**
 * The instructions an assistant needs to emit a patch for *this* catalog and
 * *this* canvas. Generated from NODE_SPECS (kinds, taglines, the exact `data`
 * fields each kind carries and their defaults) so it stays true as the catalog
 * grows, plus a summary of the graph on screen so the model can wire into it.
 *
 * `plugins` are the imported-plugin actions registered in this install (fetched
 * from the extension table — see fetchPluginActions). The builtin catalog is the
 * same everywhere, but the plugins are not, so they are passed in rather than
 * derived: the prompt lists them under "Plugins available" so the model can drop
 * a `plugin` node for one when the goal calls for it, instead of inventing an
 * integration that does not exist here.
 *
 * Used two ways: pasted into any chat by hand today, and handed to the built-in
 * assistant as its system prompt once one is wired up.
 */
export function buildDesignerPrompt(
  goal: string,
  existing?: VueFlowGraph | null,
  plugins?: PluginActionEntry[],
): string {
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
    '- `key` names the node\'s output inside its scope, and naming one is usually right — it is how a later node addresses this result (`{{$.summary}}`, `_get("$.summary")`). Leaving `key` empty is the deliberate alternative: the node commits AT its scope, so an object result is merged into the Context at that point (with `scope: "$"`, its fields land at the top level) — good for a node that contributes fields to a shared record rather than a result of its own. A non-object result from a key-less node has nowhere to go and lands under `unknow`, so give any node that emits a plain value a `key`.',
    '',
    '## Scope — and the loop it hides',
    '`scope` is a full JSONPath: dotted paths, wildcards, expressions and filter queries all work.',
    'Its cardinality decides how many times the node runs. A scope selecting ONE value runs the node once against it.',
    'A scope selecting MANY (`$.orders[*]`, `$.orders[?(@.total > 100)]`) makes the runtime run the node ONCE PER ELEMENT, each pass scoped to just that element.',
    'Those passes are a QUEUE INSIDE THE ONE NODE: they run one after another, in order, on the same node — element 2 does not start until element 1 has finished. It is NOT a branch per element. Nothing on the canvas forks, no edge is drawn per element, and the node\'s outgoing edges are followed ONCE, after every pass is done. (Contrast the `parallel` wording under Wiring: that is about edges to several DIFFERENT nodes, which is a different thing entirely.)',
    'That is how you iterate a collection — there is no loop node. Use `$` when the node should see the whole context.',
    'Inside a text field, write `{{$this}}` for the element the CURRENT pass is scoped to, and `{{$this.field}}` to reach into it.',
    'With `scope: "$.orders[*]"`, `{{$this.total}}` is this pass\'s order — `{{$.orders[0].total}}` would read the first order on every pass, which is almost always a bug.',
    'Use `{{$.path}}` for a fixed address in the Context, `{{$this…}}` for wherever this pass happens to be standing.',
    '',
    '### The one limit on a many-scope: it must not decide where the flow goes',
    'Scoping a node over a collection is the right tool whenever every element needs the SAME treatment and the flow continues the same way afterwards — enrich each order, summarise each ticket, call a service per row. An LLM node with NO bound functions belongs here too: it has one plain output, so running it per element is exactly the point.',
    'It breaks down only when the node\'s OUTGOING EDGE depends on its result, because a node has ONE set of edges for the whole node — there is no per-element edge to carry a second answer.',
    'Whenever that happens the runtime STOPS at the first element that picks a branch: the remaining elements are never processed, and it logs a warning saying how many were skipped. So a many-scope on such a node does not iterate — it quietly becomes "run the first one, then decide".',
    'This is not an LLM quirk. It applies to every node whose ports are derived from its result:',
    '- Plugin-backed nodes — `llm`, `mcp`, `cast`, `http` and an imported `plugin` action are ALL the same Plugin primitive underneath, and any of them can route at run time by firing tags. The visible signal is `functions` (LLM) or `outbound` (plugin action).',
    '- `rule` nodes, whose `handlers` are the branches the contract chooses between.',
    'So: give any node whose ports are derived — a plugin node with `functions`/`outbound`, a Rule node with `handlers` — a single-valued `scope` (usually `$`).',
    'When you need both per-element work and a decision, that is TWO nodes, and it is the correct shape rather than a workaround:',
    '1. a per-element node on `scope: "$.orders[*]"` (LLM without functions, `js`, `http`, …) writing its result under each element via `key`,',
    '2. then a decision node on `scope: "$"` reading what accumulated and routing ONCE.',
    '',
    '## Writing code (`js` and `rule` nodes, and `opa`)',
    'The scoped slice arrives as `input`. There is no `ctx`, no arguments, no function wrapper.',
    'In JavaScript the value of the LAST EXPRESSION is the node output. Do NOT write `return` — there is no function to return from. Always build the output in a NAMED variable and put that variable on the last line on its own; never end on a bare literal like `({ … })` or `[a, b, c]`. (This mirrors Rego, where `opa_result` names the variable the node emits — here you both declare the variable and name it as the last line.)',
    '```js',
    'let scopedData = input',
    'let result = { ok: scopedData.total > 0 }',
    'result',
    '```',
    'NEVER write `{{…}}` inside code. Context variables are substituted into *text* fields only (an HTTP url or body, a prompt, a plugin input) — code is handed to the interpreter exactly as written, so `{{$.x}}` in a string literal becomes the literal characters `{{$.x}}`, and anywhere else it is a syntax error that fails the node.',
    'Read data that is INSIDE the node\'s scope straight off `input` — with `scope: "$"` the whole Context is `input`, so it is `input.claim.invoiceLines`, NOT `_get("$.claim.invoiceLines")`. `_get` is only for reaching data OUTSIDE the node\'s own `scope`: `_get("$.path")` returns the value at that JSONPath and `_get("$this.field")` reaches into the current scope element. `input` is the slice, `_get` is everything else — prefer plain property access on `input` whenever the value is in scope.',
    '`_log("message")` writes a line to the run log from inside the code.',
    '```js',
    'let tier = _get("$.customer.tier")           // outside this node\'s scope — needs _get',
    'let lines = input.claim.invoiceLines || []   // inside scope — read it straight off input',
    'let result = { approved: tier === "gold" && lines.length > 0 }',
    'result',
    '```',
    'In Rego, `input` is the scoped slice and `data` holds the Conditions key/values; the node outputs the variable named by `opa_result` (set `opa_result: "x"` and the value of `x` is what the node emits).',
    '- `data` holds the kind-specific fields listed below. Omit a field to take its default. Never invent fields.',
    '- Reference Context values inside any *text* field with `{{$.path}}` (e.g. `{{$.ticket.body}}`), or `{{$this.path}}` for the node\'s current scope element — both resolved at run time. Text fields only: never in `logic_rule` (see above).',
    '- Add `note` per node/edge to explain a decision. Put assumptions and anything needing manual setup in `notes`.',
    '',
    '## Wiring',
    '### Sequence vs parallel — decide by DATA DEPENDENCY, not by the order the goal lists steps',
    'An edge means "B needs what A produced". Draw A → B ONLY when B reads A\'s output. Two steps that do NOT read each other\'s output are INDEPENDENT: do not chain them just because the goal names one before the other — that serialises work for no reason and is the wrong shape.',
    'Independent steps fan out as parallel edges from their common predecessor, then join with a `promissall` before the first node that needs them all. The classic case is two data loads that both feed a later step: "load the policy record from the document store" and "retrieve the coverage clauses from the vector store" do not depend on each other, so run BOTH in parallel and `promissall` into the step that uses both — never make one wait behind the other.',
    'Sequence is only for a real chain: assess (needs both retrievals) → calculate payable (needs the assessment) → route (needs the amount). Each of those genuinely reads the previous one, so each is a single edge in a line.',
    'Rule of thumb: list what each step reads. Same upstream input and independent of its siblings → parallel branches under a `promissall`. Reads a sibling\'s output → an edge from that sibling.',
    '- Branching has exactly ONE source: a node having several outgoing EDGES that stay active. That is the only way a run forks — the runtime starts one task per edge it follows. Nothing else branches: not scope cardinality (that is a queue inside a single node), not `key`, not a node running several times. If two things must happen independently, draw two edges.',
    '- A node with derived output ports (LLM with bound functions, Rule with handlers, an imported plugin action with `outbound`) has NO default handle: every edge leaving it MUST name a `port`.',
    '- For an LLM node, `port` is the bound function\'s `name` — the model calling that function is what routes the flow down that edge.',
    "- Every LLM node with functions also has an `_exception` port: use `port: \"_exception\"` for the branch that handles a plugin error or the model picking no function.",
    "- For a Rule node, `port` is the handler's `name` — the tag its branch fires.",
    "- For an imported `plugin` action, `port` is the outbound entry's `title` (falling back to its joined `tags`) — the plugin fires those tags at run time, exactly as a Rule does.",
    '- Other kinds have a single unnamed output: omit `port`.',
    '- A node with derived ports routes for the whole node, so its `scope` must select ONE value (usually `$`). Never give a wildcard or filter scope to any plugin-backed node carrying `functions`/`outbound` (`llm`, `mcp`, `cast`, `http`, `plugin` — all the same primitive), nor to a Rule node with `handlers`. See the many-scope limit above.',
    '- Fanning out to several nodes runs them in parallel.',
    '- A Rule node that fires no tag at run time prunes every one of its edges: that branch of the flow simply ends. Make sure the handlers cover every case, or add a default branch.',
    '',
    '## Joining branches back together',
    'Edges INTO a node do not merge. The runtime starts one task per edge it follows, so a node with TWO inbound edges RUNS TWICE — once per branch, both in parallel. Two branches meeting at one "send report" node send two reports. This is the easiest way to get a workflow subtly wrong, and nothing about it looks unusual on the canvas.',
    '`promissall` is the ONLY thing that merges branches: it waits until every inbound branch has finished, then continues ONCE, with the context all of them wrote. Whenever two or more edges would arrive at the same node and you mean "when both are done", put a `promissall` in front of that node and wire the branches into the `promissall` instead.',
    'Two rules when you use one:',
    '- It waits for exactly the nodes wired into it, so wire every branch it must wait for directly into it.',
    '- Every branch feeding it must run the SAME number of times. It waits for its inbound nodes to reach the same round, so if one of them is itself a doubly-run node (a node with two inbound edges of its own) it waits for a round that never comes and the run stalls until the process times out. Keep each branch single-run — where branches converge earlier, converge them with a `promissall` there too rather than letting a node run twice.',
    'A `promissall` may wait on another `promissall`.',
    '',
    '## Node kinds',
  )

  for (const spec of Object.values(NODE_SPECS)) {
    // `plugin` is not a fixed builtin — it is the shell every imported-plugin
    // action shares, and it means nothing without a `pluginId` + `action` from
    // *this* install. Those are listed under "Plugins available" with the exact
    // way to reference them, so the generic block here would only invite the
    // model to emit a plugin node with empty identity. Skip it.
    if (spec.kind === 'plugin') continue
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
      lines.push(
        'An MCP node runs in one of two modes; set `mcpMode` and keep `request` in step:',
        '- `mcpMode: "tool"` (`request: "call_tool"`) — tool-only, an integration: it calls ONE named tool on the server and returns its result, no model involved. Set `tool` to the tool name once its tools are loaded from the server in the app; `arguments` are shaped by that tool\'s input schema. Use this when the step is a single deterministic call.',
        '- `mcpMode: "llm"` (`request: "run"`) — driven by a model: it binds ALL of the server\'s tools and lets the model call them itself over a conversation. Seed it with the `system` / `prompt` shorthand (same as an LLM node); the provider/model come from a settings profile. Tool calls stay inside the node — they never surface as workflow edges — so this node has a single output. Use this when a task needs a model to decide which of the server\'s tools to call.',
        'Either way the tool list is loaded from the server in the app, not written here; leave `functions` empty.',
      )
    }
    if (spec.kind === 'http') {
      lines.push(
        'Put the request in `body`: `{ "method": "GET|POST|…", "url": "https://…", "headers": [{ "key": "", "value": "" }], "query": [{ "key": "", "value": "" }], "body": "", "body_type": "json" }`.',
        '`headers` and `query` are key/value rows; `body` is the raw request body (a JSON string when `body_type: "json"`); `body_type` (json | form | text) sets the Content-Type. Any field — url, header value, body — may embed `{{$.path}}` context vars, resolved at run time.',
      )
    }
    if (spec.kind === 'docstore' || spec.kind === 'vecstore') {
      lines.push(
        'Leave `storeId` "" (the designer picks the store in the drawer — note it) and set `action` to "read" or "write".',
        spec.kind === 'docstore'
          ? 'A read (`action: "read"`) runs a basic SQL `query`. You do not know the store\'s columns, so write a simple skeleton with placeholders for the designer to fill: `select * from <STORE_NAME> where <field> = <value>`.'
          : 'A read (`action: "read"`) runs `query` — the text to match by similarity: a literal string, or `{{$.path}}` to embed text from the Context (e.g. `{{$.ticket.body}}`).',
        'A write (`action: "write"`) stores the payload selected by `input` (a JSONPath, default the node `scope`); no query.',
      )
    }
    if (spec.kind === 'rule') {
      lines.push(
        'Handlers are `{ "id": "h1", "name": "approved", "title": "Approved" }`; each is a routed branch.',
        '`name` is the branch\'s route tag — the decision has to fire it and the edge leaving that port carries it — while `title` only labels the port on the canvas.',
        '`logic_rule` is JS returning a value (`lang: "js"`) or Rego (`lang: "opa"`).',
      )
    }
    if (spec.kind === 'goto') {
      lines.push(
        'A Goto is a subroutine call: control jumps to the target node in the target flow, and when that flow reaches the Goto\'s end node it continues to whatever follows the Goto. Each Goto runs its own private copy of the flow it calls, so several branches may enter one Goto, two Gotos may call the same flow and even share an end node, and the called flow\'s own wiring is left untouched for anything else that uses it.',
        'Two things to keep in mind: the target flow is loaded once per Goto node, so it costs a copy of that flow (do not reach for a Goto to save re-drawing one or two nodes), and nesting is bounded — a Goto that jumps back into a flow already being called re-enters the same copy rather than nesting deeper, which is what makes a loop through a Goto terminate.',
      )
    }
    if (spec.kind === 'hitl') {
      lines.push(
        '`prompt` is the node: it tells the session what to establish with the person and may embed `{{$.path}}` context variables, which the runtime resolves before the task is recorded. Write it to read the run\'s history and work out what to ask — there is no static question list, because a flow reaches a human exactly when what to ask is not yet known.',
        '`mode` is "park" (the run stops here and resumes once the session closes) or "continue" (record the task, carry on). `channel` is "direct" (only one supported today), "telegram" or "whatsapp".',
      )
    }
  }

  lines.push(...pluginPromptLines(plugins))

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
