/**
 * The FloMorphic node catalog — the 9 builtin canvas nodes.
 *
 * FloMorphic is a *product* layer on top of the Inflowenger runtime. Each canvas
 * node has a high-level *morphic type* (the Vue Flow node `type`, and the
 * discriminator the backend compiler reads) that LOWERS to one of Inflowenger's
 * primitives on compile:
 *
 *   Void · Code · Contract · Extrinsic · Plugin · GoTo
 *
 * These 9 nodes are seeded server-side into the extension table and fetched over
 * `/extension` (kind = builtin) to build the palette. This catalog is the
 * front-end *behaviour registry* for those same types: it owns the per-type
 * defaults, derived output ports, icon and the "compiles to" label — the parts
 * that are code, not data. The morphic `type` strings here MUST match the seed's
 * `type` and the compiler's `NodeBuilder` cases.
 *
 * Data-field names mirror the Inflowenger inspector nodes so the compiler reads
 * them unchanged: contract/rule → lang·logic_rule·opa_result·conditions·handlers;
 * plugin (llm/cast) → subject_prefix·body·request·idle_min; extrinsic → its bind.
 *
 * Every node shares three universal fields, mirrored on the compiled node:
 *   - title: human label
 *   - key:   where the node output is written into the Context
 *   - scope: a JSONPath slice of Context the node reads / writes
 */

export type NodeKind =
  | 'startNode'
  | 'goto'
  | 'hitl'
  | 'docstore'
  | 'vecstore'
  | 'promissall'
  | 'llm'
  | 'mcp'
  | 'rule'
  | 'js'
  | 'opa'
  | 'until'
  | 'cast'

export type PaletteGroupId = 'flow' | 'ai' | 'stores' | 'human'

/** Universal fields present on every node's `data`, plus per-kind extras. */
export interface BaseNodeData {
  title: string
  key: string
  scope: string
  [extra: string]: unknown
}

/** A derived output handle rendered on the right edge of a node. */
export interface NodePort {
  id: string
  label: string
}

export interface NodeSpec {
  kind: NodeKind
  /** Vue Flow node `type` (also the discriminator the backend compiler reads). */
  type: NodeKind
  label: string
  icon: string
  color: string
  group: PaletteGroupId
  tagline: string
  description: string
  /** Inflowenger primitive(s) this node compiles down to (display label). */
  primitives: string
  /**
   * Lowers to a Plugin primitive (llm / mcp / cast). Plugin nodes take their
   * runtime config from a settings profile, so the drawer shows the profile
   * picker only for these (see {@link usesSettingsProfile} in lib/nodeSettings).
   */
  plugin?: boolean
  /** Entry node — no incoming handle. */
  entry?: boolean
  /** Terminal node — no outgoing handle. */
  terminal?: boolean
  /** Factory for a fresh node's `data`. */
  defaults: () => BaseNodeData
  /** Short one-line preview shown on the node body. */
  preview?: (data: BaseNodeData) => string
  /**
   * Derived output ports. When present and non-empty, the node renders one
   * source handle per port (e.g. LLM functions, Rule condition handlers) instead
   * of the single default handle.
   */
  ports?: (data: BaseNodeData) => NodePort[]
}

const spec = (s: NodeSpec): NodeSpec => s

/** Coerce an unknown array-of-objects field to a typed list (defensive). */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : []
}

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  // ---- Flow ----
  startNode: spec({
    kind: 'startNode',
    type: 'startNode',
    label: 'Start',
    icon: 'node-start',
    color: '#16a34a',
    group: 'flow',
    tagline: 'Entry point',
    description:
      'The entry point of a workflow. Every flow requires exactly one. Compiles to a Void start marker in Inflowenger.',
    primitives: 'Void',
    entry: true,
    defaults: () => ({ title: 'Start', key: '', scope: '$' }),
    preview: () => 'on run',
  }),
  promissall: spec({
    kind: 'promissall',
    type: 'promissall',
    label: 'Wait for All',
    icon: 'node-wait',
    color: '#64748b',
    group: 'flow',
    tagline: 'Await all parallel branches',
    description:
      'A synchronisation barrier — the flow equivalent of JavaScript `Promise.all` or WaitGroup in Golang .' +
      'When a node fans out to several outbound branches, the Inflowenger runtime launches ' +
      'them all in parallel and they run simultaneously. Most of the time each branch simply ' +
      'flows on with the context it already has. But when a later step must not start until ' +
      'every one of those parallel branches has finished, place a `Wait for All` in front of it: ' +
      'it holds until all inbound branches complete, merges each of their results into the ' +
      'shared context, and only then continues with the fully-updated context. ' +
      'Compiles to a Void node whose `depend` is the set of all inbound nodes.',
    primitives: 'Void',
    // A pure join with no result binding: key / scope are hidden in the drawer
    // and always serialised empty (see NodeSettingDetails / WorkflowCanvas).
    defaults: () => ({ title: 'Wait for All', key: '', scope: '' }),
    preview: () => 'await all branches',
  }),
  until: spec({
    kind: 'until',
    type: 'until',
    label: 'Continue After',
    icon: 'node-until',
    color: '#059669',
    group: 'flow',
    tagline: 'Resume at a later time',
    description:
      'Park the flow and resume it at a scheduled time. Compiles to an Extrinsic against `svc.continue.at`, which records the captured outbound nodes and re-launches them at the given time. The delay/at inputs resolve to a single unix time (absolute at compile time, or `now + delay` at run time).',
    primitives: 'Extrinsic · svc.continue.at',
    // mode is either a delay unit (seconds/minutes/hour/day, paired with `value`)
    // or `at` (an absolute date/time in `at`). See NodeConfig's Continue After
    // section and the backend NODE_UNTIL compiler case.
    defaults: () => ({ title: 'Continue After', key: '', scope: '$', mode: 'hour', value: 1, at: '' }),
    preview: (d) => {
      if (d.mode === 'at') return d.at ? `at ${String(d.at)}` : 'at —'
      return `+${String(d.value ?? 0)} ${String(d.mode ?? 'sec')}`
    },
  }),

  goto: spec({
    kind: 'goto',
    type: 'goto',
    label: 'Goto',
    icon: 'node-goto',
    color: '#4f46e5',
    group: 'flow',
    tagline: 'Jump to another flow',
    description:
      'Transfer control to a node in another (or the same) workflow, like a subroutine jump. Compiles to a GoTo.',
    primitives: 'GoTo',
    // A pure redirect with no result binding: key / scope are hidden in the
    // drawer and on the node, and always serialised empty (see NO_BINDING_KINDS
    // in NodeSettingDetails / WorkflowCanvas / FlowNode).
    defaults: () => ({ title: 'Goto', key: '', scope: '$', goto: { flowId: '', from_nodeId: '', end_nodeId: '' } }),
    preview: (d) => {
      const g = (d.goto ?? {}) as Record<string, unknown>
      return g.flowId ? `→ ${String(g.flowId)}` : 'no target'
    },
  }),

  // ---- AI ----
  llm: spec({
    kind: 'llm',
    type: 'llm',
    label: 'LLM',
    icon: 'node-llm',
    color: '#8b2fe0',
    group: 'ai',
    tagline: 'Call a model with tools',
    description:
      'Call a language model. Its required global config comes from a settings profile (the inflowv1 plugin settings); `body` holds the prompt template. Each bound function becomes an output port the model can route through. Compiles to a Plugin node.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'LLM',
      key: 'messages',
      scope: '$',
      subject_prefix: 'llm',
      idle_min: 5,
      request: 'run',
      body: { prompt: '' },
      // [{ id, name, title }] — each renders as an output port (see ports()).
      functions: [],
    }),
    preview: (d) => {
      const n = asRows(d.functions).length
      return n ? `${n} function${n === 1 ? '' : 's'}` : 'no functions'
    },
    ports: (d) =>
      asRows(d.functions).map((f, i) => ({
        id: String(f.id ?? f.name ?? `fn${i}`),
        label: String(f.title ?? f.name ?? `fn${i + 1}`),
      })),
  }),
  rule: spec({
    kind: 'rule',
    type: 'rule',
    label: 'Rule',
    icon: 'node-rule',
    color: '#d97706',
    group: 'ai',
    tagline: 'Branch on a contract',
    description:
      'Evaluate a rule (JavaScript or OPA/Rego) over the scoped context and route through matching handlers. Compiles to a Contract; each handler is an output port for a routed branch.',
    primitives: 'Contract',
    defaults: () => ({
      title: 'Rule',
      key: 'decision',
      scope: '$',
      lang: 'js',
      logic_rule: '// return the result evaluated over the scoped context\nreturn { pass: true }\n',
      opa_result: '',
      // [{ key, value }]
      conditions: [],
      // [{ id, tags: [], color }] — each renders as an output port (see ports()).
      handlers: [],
    }),
    preview: (d) => {
      const n = asRows(d.handlers).length
      return `${String(d.lang ?? 'js')} · ${n} handler${n === 1 ? '' : 's'}`
    },
    ports: (d) =>
      asRows(d.handlers).map((h, i) => ({
        id: String(h.id ?? `h${i}`),
        label: Array.isArray(h.tags) ? (h.tags as unknown[]).join(' / ') || `branch ${i + 1}` : `branch ${i + 1}`,
      })),
  }),

  mcp: spec({
    kind: 'mcp',
    type: 'mcp',
    label: 'MCP',
    icon: 'node-mcp',
    color: '#0891b2',
    group: 'ai',
    tagline: 'MCP client',
    description:
      'Connect to an MCP server as a client, exposing its tools and resources to the flow. Its connection parameters (URL, auth, transport) come from its settings. Compiles to a Plugin node.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'MCP',
      key: 'mcp',
      scope: '$',
      subject_prefix: 'mcp',
      idle_min: 5,
      request: 'run',
      body: {},
      url: '',
      transport: 'stdio',
      auth: '',
    }),
    preview: (d) => String(d.url || 'no server'),
  }),

  js: spec({
    kind: 'js',
    type: 'js',
    label: 'JS',
    icon: 'node-code',
    color: '#eab308',
    group: 'ai',
    tagline: 'Run JavaScript',
    description:
      'Run a JavaScript step against the scoped context and write the result back to `key`. Compiles to a Code node (variant `js`) in the Inflowenger ecosystem.',
    primitives: 'Code · js',
    defaults: () => ({
      title: 'JS',
      key: 'result',
      scope: '$',
      lang: 'js',
      logic_rule: '// ctx is the scoped context slice\nreturn { ok: true }\n',
    }),
    preview: (d) => `js → ${d.key || 'result'}`,
  }),
  opa: spec({
    kind: 'opa',
    type: 'opa',
    label: 'OPA',
    icon: 'node-code',
    color: '#7c3aed',
    group: 'ai',
    tagline: 'Run OPA / Rego',
    description:
      'Evaluate an OPA/Rego policy against the scoped context and write the selected result back to `key`. Compiles to a Code node (variant `opa`) in the Inflowenger ecosystem.',
    primitives: 'Code · opa',
    defaults: () => ({
      title: 'OPA',
      key: 'result',
      scope: '$',
      lang: 'opa',
      logic_rule: 'package flomorphic\n\nresult := true\n',
      opa_result: 'result',
      // [{ key, value }] — extra criteria data available to the policy.
      conditions: [],
    }),
    preview: (d) => `opa → ${String(d.opa_result || d.key || 'result')}`,
  }),

  // ---- Stores ----
  docstore: spec({
    kind: 'docstore',
    type: 'docstore',
    label: 'Doc Store',
    icon: 'node-docstore',
    color: '#0284c7',
    group: 'stores',
    tagline: 'Read / write documents',
    description:
      'Read (run a query) or write documents in a referenced Document memory store. A read runs `query` against the store; a write takes its payload from `input` (the node `scope` or an input JSONPath). Compiles to an Extrinsic on `svc.store.doc.{ACTION}` (inflo-fusion listens on `svc.store.doc.*`).',
    primitives: 'Extrinsic · svc.store.doc.*',
    defaults: () => ({ title: 'Doc Store', key: 'docResult', scope: '$', storeId: '', action: 'read', query: '', input: '$' }),
    preview: (d) => `${String(d.action ?? 'read')}${d.storeId ? ' · ' + String(d.storeId) : ' · no store'}`,
  }),
  vecstore: spec({
    kind: 'vecstore',
    type: 'vecstore',
    label: 'Vector Store',
    icon: 'node-vecstore',
    color: '#0ea5e9',
    group: 'stores',
    tagline: 'Read / write vectors',
    description:
      'Read (run a query) or write into a referenced Vector memory store. A read runs `query` against the store; a write takes its payload from `input` (the node `scope` or an input JSONPath). Compiles to an Extrinsic on `svc.store.vec.{ACTION}` (inflo-fusion listens on `svc.store.vec.*`).',
    primitives: 'Extrinsic · svc.store.vec.*',
    defaults: () => ({ title: 'Vector Store', key: 'vecResult', scope: '$', storeId: '', action: 'read', query: '', input: '$' }),
    preview: (d) => `${String(d.action ?? 'read')}${d.storeId ? ' · ' + String(d.storeId) : ' · no store'}`,
  }),
  cast: spec({
    kind: 'cast',
    type: 'cast',
    label: 'Cast / Mapping',
    icon: 'node-cast',
    color: '#3b82f6',
    group: 'stores',
    tagline: 'Map fields into a shape',
    description:
      'Build a value by mapping each target key (from a referenced Document store schema) to a static value or a JSONPath resolved against the run-time context. Compiles to a Plugin node.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'Cast',
      key: 'mapped',
      scope: '$',
      subject_prefix: 'cast',
      idle_min: 5,
      request: 'run',
      body: {},
      storeId: '',
      // [{ key, mode: 'static' | 'jsonpath', value }]
      mappings: [],
    }),
    preview: (d) => {
      const n = asRows(d.mappings).length
      return n ? `${n} mapping${n === 1 ? '' : 's'}` : 'no mappings'
    },
  }),

  // ---- Human ----
  hitl: spec({
    kind: 'hitl',
    type: 'hitl',
    label: 'Human in the Loop',
    icon: 'node-human',
    color: '#a855f7',
    group: 'human',
    tagline: 'Ask a human',
    description:
      'Pause the flow for a person: pose one or more questions and wait for their answers before continuing (or a human closes the task to finish here). Compiles to an Extrinsic against the backend `hitl` service (`svc.hitl.add`), which records a Human Task surfaced under Operate → Human Task.',
    primitives: 'Extrinsic · svc.hitl.add',
    defaults: () => ({ title: 'Human in the Loop', key: 'humanReply', scope: '$', operationData: [] }),
    preview: (d) => {
      const n = asRows(d.operationData).length
      return n ? `${n} field${n === 1 ? '' : 's'}` : 'no fields'
    },
  }),
}

export const PALETTE_GROUPS: { id: PaletteGroupId; label: string; kinds: NodeKind[] }[] = [
  { id: 'flow', label: 'Flow', kinds: ['startNode', 'promissall', 'until', 'goto'] },
  { id: 'ai', label: 'AI & Logic', kinds: ['llm', 'mcp', 'rule', 'js', 'opa'] },
  { id: 'stores', label: 'Stores', kinds: ['docstore', 'vecstore', 'cast'] },
  { id: 'human', label: 'Human', kinds: ['hitl'] },
]

export const NODE_LIST: NodeSpec[] = Object.values(NODE_SPECS)

/** The node a fresh workflow starts with. */
export const DEFAULT_START_KIND: NodeKind = 'startNode'

export function specForType(type: string): NodeSpec | undefined {
  return NODE_SPECS[type as NodeKind]
}
