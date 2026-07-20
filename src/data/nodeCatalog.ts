/**
 * The FloMorphic node catalog.
 *
 * FloMorphic is a *product* layer on top of the Inflowenger runtime. Its canvas
 * nodes are high-level, intent-driven building blocks (LLMs, tools, MCP clients,
 * guardrails, human-in-the-loop …) — declarative front-end nodes that the
 * backend COMPILES DOWN to Inflowenger's small set of primitives:
 *
 *   Void · Code · Contract · Extrinsic · Plugin · GoTo
 *
 * So the palette speaks the language of *what you want to build*, while the
 * `primitives` field records what each node lowers to on compile.
 *
 * There is deliberately no "Loop" node: loops are not a primitive here. They
 * emerge from connections + a Condition (Contract). An LLM node appends to the
 * message stack on the context; a Condition checks whether the task is
 * satisfied and, if not, routes an edge back to the LLM — that cycle *is* the
 * loop.
 *
 * Every node shares three universal fields, mirrored on the compiled node:
 *   - title: human label
 *   - key:   where the node output is written into the Context
 *   - scope: a JSONPath slice of Context the node reads / writes
 */

export type NodeKind =
  | 'trigger'
  | 'webhook'
  | 'schedule'
  | 'llm'
  | 'tool'
  | 'mcp'
  | 'retriever'
  | 'memory'
  | 'guardrail'
  | 'condition'
  | 'transform'
  | 'humanInLoop'
  | 'merge'
  | 'http'
  | 'extrinsic'
  | 'plugin'
  | 'subflow'
  | 'output'

export type PaletteGroupId = 'triggers' | 'ai' | 'logic' | 'io'

/** Universal fields present on every node's `data`, plus per-kind extras. */
export interface BaseNodeData {
  title: string
  key: string
  scope: string
  [extra: string]: unknown
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
  /** Inflowenger primitive(s) this node compiles down to. */
  primitives: string
  /** Entry node — no incoming handle. */
  entry?: boolean
  /** Terminal node — no outgoing handle. */
  terminal?: boolean
  /** Emits multiple tagged branches. */
  branching?: boolean
  /** Factory for a fresh node's `data`. */
  defaults: () => BaseNodeData
  /** Short one-line preview shown on the node body. */
  preview?: (data: BaseNodeData) => string
}

const spec = (s: NodeSpec): NodeSpec => s

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  // ---- Triggers ----
  trigger: spec({
    kind: 'trigger',
    type: 'trigger',
    label: 'Manual Trigger',
    icon: 'node-trigger',
    color: '#16a34a',
    group: 'triggers',
    tagline: 'Start the flow',
    description: 'Entry point that starts a process with an initial context. Compiles to a Void start marker.',
    primitives: 'Void',
    entry: true,
    defaults: () => ({ title: 'Manual Trigger', key: '', scope: '$' }),
    preview: () => 'on run',
  }),
  webhook: spec({
    kind: 'webhook',
    type: 'webhook',
    label: 'Webhook',
    icon: 'node-webhook',
    color: '#0d9488',
    group: 'triggers',
    tagline: 'Inbound HTTP',
    description: 'Start a flow when an HTTP request hits a registered endpoint. Backed by a Plugin listener.',
    primitives: 'Plugin',
    entry: true,
    defaults: () => ({ title: 'Webhook', key: 'request', scope: '$', method: 'POST', path: '/hooks/new' }),
    preview: (d) => `${String(d.method ?? 'POST')} ${String(d.path ?? '')}`,
  }),
  schedule: spec({
    kind: 'schedule',
    type: 'schedule',
    label: 'Schedule',
    icon: 'node-schedule',
    color: '#059669',
    group: 'triggers',
    tagline: 'Cron trigger',
    description: 'Start a flow on a recurring schedule. Backed by a Plugin timer.',
    primitives: 'Plugin',
    entry: true,
    defaults: () => ({ title: 'Schedule', key: '', scope: '$', cron: '0 * * * *' }),
    preview: (d) => `cron: ${String(d.cron ?? '')}`,
  }),

  // ---- AI Harness ----
  llm: spec({
    kind: 'llm',
    type: 'llm',
    label: 'LLM',
    icon: 'node-llm',
    color: '#8b2fe0',
    group: 'ai',
    tagline: 'LLM with bound tools',
    description:
      'Call a language model with tools bound to it. It reads the message stack from context and appends its reply. Wire Tool / MCP nodes to bind capabilities; route its output through a Condition to loop.',
    primitives: 'Plugin',
    defaults: () => ({
      title: 'LLM',
      key: 'messages',
      scope: '$',
      model: 'claude-sonnet-5',
      system: 'You are a helpful assistant.',
      tools: [],
      temperature: 0.7,
    }),
    preview: (d) => String(d.model ?? 'model'),
  }),
  tool: spec({
    kind: 'tool',
    type: 'tool',
    label: 'Tool',
    icon: 'node-tool',
    color: '#06b6d4',
    group: 'ai',
    tagline: 'Bindable capability',
    description: 'A capability an LLM can call. Wire it into an LLM node to bind it. Compiles to a Plugin or Extrinsic call.',
    primitives: 'Plugin · Extrinsic',
    defaults: () => ({ title: 'Tool', key: 'toolResult', scope: '$', name: '', schema: {} }),
    preview: (d) => String(d.name || 'unbound tool'),
  }),
  mcp: spec({
    kind: 'mcp',
    type: 'mcp',
    label: 'MCP',
    icon: 'node-mcp',
    color: '#0ea5e9',
    group: 'ai',
    tagline: 'MCP client',
    description:
      'Connect to an MCP server through a plugin-backed client, exposing its tools and resources to the flow (and to bound LLM nodes).',
    primitives: 'Plugin',
    defaults: () => ({ title: 'MCP', key: 'mcp', scope: '$', server: '', transport: 'stdio' }),
    preview: (d) => String(d.server || 'no server'),
  }),
  retriever: spec({
    kind: 'retriever',
    type: 'retriever',
    label: 'Retriever',
    icon: 'node-retriever',
    color: '#0284c7',
    group: 'ai',
    tagline: 'RAG search',
    description: 'Fetch relevant context from a knowledge source (vector / keyword). Backed by a Plugin adapter.',
    primitives: 'Plugin',
    defaults: () => ({ title: 'Retriever', key: 'documents', scope: '$', source: '', topK: 5 }),
    preview: (d) => `top ${String(d.topK ?? 5)}`,
  }),
  memory: spec({
    kind: 'memory',
    type: 'memory',
    label: 'Memory',
    icon: 'node-memory',
    color: '#f59e0b',
    group: 'ai',
    tagline: 'Read / write a store',
    description:
      'Read from or write to a defined Memory store (vector or document). Define stores under Data → Memory, then reference one here by id. Compiles to a Plugin store plus Code merge.',
    primitives: 'Plugin · Code',
    defaults: () => ({ title: 'Memory', key: 'memory', scope: '$', memoryId: '', op: 'read' }),
    preview: (d) => `${String(d.op ?? 'read')}${d.memoryId ? ' · ' + String(d.memoryId) : ' · no store'}`,
  }),
  guardrail: spec({
    kind: 'guardrail',
    type: 'guardrail',
    label: 'Guardrail',
    icon: 'node-guardrail',
    color: '#e11d48',
    group: 'ai',
    tagline: 'Validate & gate',
    description:
      'Validate or moderate a value and gate the flow on the result. Compiles to a Code check plus a Contract branch.',
    primitives: 'Code · Contract',
    branching: true,
    defaults: () => ({ title: 'Guardrail', key: 'checked', scope: '$', rule: 'valid', tags: ['pass', 'fail'] }),
    preview: (d) => (Array.isArray(d.tags) ? (d.tags as string[]).join(' / ') : 'pass / fail'),
  }),

  // ---- Logic & flow ----
  condition: spec({
    kind: 'condition',
    type: 'condition',
    label: 'Condition',
    icon: 'node-condition',
    color: '#d97706',
    group: 'logic',
    tagline: 'Branch — and build loops',
    description:
      'Evaluate a rule and fire the matching branch(es). Compiles directly to a Contract. Route a branch back to an earlier node to build a loop (e.g. keep calling the LLM until the task is satisfied).',
    primitives: 'Contract',
    branching: true,
    defaults: () => ({
      title: 'Condition',
      key: 'decision',
      scope: '$',
      language: 'javascript',
      source: "// return an array of tags to fire matching branches\n// e.g. return done ? ['done'] : ['retry']\nreturn ['done']\n",
      tags: ['done', 'retry'],
    }),
    preview: (d) => (Array.isArray(d.tags) && d.tags.length ? (d.tags as string[]).join(', ') : 'decision'),
  }),
  transform: spec({
    kind: 'transform',
    type: 'transform',
    label: 'Transform',
    icon: 'node-transform',
    color: '#3b82f6',
    group: 'logic',
    tagline: 'Shape data with code',
    description: 'Run JavaScript / OPA against the scoped context and write the result back. Compiles to a Code node.',
    primitives: 'Code',
    defaults: () => ({
      title: 'Transform',
      key: 'result',
      scope: '$',
      language: 'javascript',
      source: '// ctx is the scoped context slice\nreturn { ok: true }\n',
    }),
    preview: (d) => `${String(d.language ?? 'javascript')} → ${d.key || 'result'}`,
  }),
  humanInLoop: spec({
    kind: 'humanInLoop',
    type: 'humanInLoop',
    label: 'Human in the Loop',
    icon: 'node-human',
    color: '#a855f7',
    group: 'logic',
    tagline: 'Ask a human',
    description:
      'Pause the flow for a person: pose one or more questions and wait for their answers before continuing (or a human closes the task to finish here). Compiles to an Extrinsic against the backend `hitl` service, which records a Human Task surfaced under Operate → Human Task.',
    primitives: 'Extrinsic',
    defaults: () => ({ title: 'Human in the Loop', key: 'humanReply', scope: '$', questions: [''] }),
    preview: (d) => {
      const qs = Array.isArray(d.questions) ? (d.questions as unknown[]).filter((q) => String(q ?? '').trim()) : []
      return qs.length ? `${qs.length} question${qs.length === 1 ? '' : 's'}` : 'no questions'
    },
  }),
  merge: spec({
    kind: 'merge',
    type: 'merge',
    label: 'Merge',
    icon: 'node-merge',
    color: '#64748b',
    group: 'logic',
    tagline: 'Join branches',
    description: 'A fan-in / join point that waits for its dependencies. Compiles to a Void node.',
    primitives: 'Void',
    defaults: () => ({ title: 'Merge', key: '', scope: '$' }),
    preview: () => 'fan-in',
  }),

  // ---- Integrations ----
  http: spec({
    kind: 'http',
    type: 'http',
    label: 'HTTP Request',
    icon: 'node-http',
    color: '#0891b2',
    group: 'io',
    tagline: 'Call an API',
    description: 'Call any REST/HTTP endpoint and inject the response into context. Backed by a Plugin adapter.',
    primitives: 'Plugin',
    defaults: () => ({ title: 'HTTP Request', key: 'response', scope: '$', method: 'GET', url: '' }),
    preview: (d) => `${String(d.method ?? 'GET')} ${String(d.url ?? '')}`.trim(),
  }),
  extrinsic: spec({
    kind: 'extrinsic',
    type: 'extrinsic',
    label: 'Extrinsic',
    icon: 'node-extrinsic',
    color: '#14b8a6',
    group: 'io',
    tagline: 'Call your backend',
    description: 'Publish to a NATS subject your own backend registered; the reply becomes the output. A native Extrinsic.',
    primitives: 'Extrinsic',
    defaults: () => ({ title: 'Extrinsic', key: 'response', scope: '$', subject: '', payload: '{}' }),
    preview: (d) => String(d.subject || 'no subject'),
  }),
  plugin: spec({
    kind: 'plugin',
    type: 'plugin',
    label: 'Plugin',
    icon: 'node-plugin',
    color: '#9333ea',
    group: 'io',
    tagline: 'External process',
    description:
      'Hand execution to a live external process (an installed Extension) with its own state, connections and UI. The most powerful primitive — the escape hatch to the outside world.',
    primitives: 'Plugin',
    defaults: () => ({ title: 'Plugin', key: 'output', scope: '$', extensionId: '', action: '', settings: {} }),
    preview: (d) => String(d.extensionId || 'unbound plugin'),
  }),
  subflow: spec({
    kind: 'subflow',
    type: 'subflow',
    label: 'Sub-workflow',
    icon: 'node-subflow',
    color: '#4f46e5',
    group: 'io',
    tagline: 'Reuse a flow',
    description: 'Call another workflow and return, like a subroutine. Compiles to a GoTo.',
    primitives: 'GoTo',
    defaults: () => ({ title: 'Sub-workflow', key: '', scope: '$', flowId: '' }),
    preview: (d) => (d.flowId ? `→ ${String(d.flowId)}` : 'no target flow'),
  }),
  output: spec({
    kind: 'output',
    type: 'output',
    label: 'Output',
    icon: 'node-output',
    color: '#16a34a',
    group: 'io',
    tagline: 'Return a result',
    description: 'Shape and return the final result of the flow. Compiles to a Code / Void terminal.',
    primitives: 'Code · Void',
    terminal: true,
    defaults: () => ({ title: 'Output', key: 'output', scope: '$', template: '' }),
    preview: (d) => `→ ${d.key || 'output'}`,
  }),
}

export const PALETTE_GROUPS: { id: PaletteGroupId; label: string; kinds: NodeKind[] }[] = [
  { id: 'triggers', label: 'Triggers', kinds: ['trigger', 'webhook', 'schedule'] },
  { id: 'ai', label: 'AI Harness', kinds: ['llm', 'tool', 'mcp', 'retriever', 'memory', 'guardrail'] },
  { id: 'logic', label: 'Logic & Flow', kinds: ['condition', 'transform', 'humanInLoop', 'merge'] },
  { id: 'io', label: 'Integrations', kinds: ['http', 'extrinsic', 'plugin', 'subflow', 'output'] },
]

export const NODE_LIST: NodeSpec[] = Object.values(NODE_SPECS)

/** The node a fresh workflow starts with. */
export const DEFAULT_START_KIND: NodeKind = 'trigger'

export function specForType(type: string): NodeSpec | undefined {
  return NODE_SPECS[type as NodeKind]
}
