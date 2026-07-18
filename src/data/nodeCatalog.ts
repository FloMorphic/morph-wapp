/**
 * The FloMorphic node catalog.
 *
 * FloMorphic is a *product* layer on top of the Inflowenger runtime. Its canvas
 * nodes are high-level, intent-driven building blocks (agents, models, tools,
 * loops, guardrails …) — declarative front-end nodes that the backend COMPILES
 * DOWN to Inflowenger's small set of primitives:
 *
 *   Void · Code · Contract · Extrinsic · Plugin · GoTo
 *
 * So the palette here speaks the language of *what you want to build*, while the
 * `primitives` field on each spec records what it lowers to on compile. That's
 * the difference from `inflow-inspector`, which edits the raw primitives.
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
  | 'agent'
  | 'model'
  | 'tool'
  | 'retriever'
  | 'memory'
  | 'guardrail'
  | 'condition'
  | 'transform'
  | 'loop'
  | 'approval'
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
  agent: spec({
    kind: 'agent',
    type: 'agent',
    label: 'AI Agent',
    icon: 'node-agent',
    color: '#8b2fe0',
    group: 'ai',
    tagline: 'Autonomous reasoning',
    description:
      'A tool-using agent that reasons in a loop until it reaches a goal. Compiles to a Plugin harness wrapped in a Loop system.',
    primitives: 'Plugin · Loop',
    defaults: () => ({
      title: 'AI Agent',
      key: 'agent',
      scope: '$',
      model: 'claude-sonnet-5',
      instructions: 'You are a helpful assistant.',
      tools: [],
      maxSteps: 8,
    }),
    preview: (d) => String(d.model ?? 'model'),
  }),
  model: spec({
    kind: 'model',
    type: 'model',
    label: 'Model Call',
    icon: 'node-model',
    color: '#6366f1',
    group: 'ai',
    tagline: 'Single LLM call',
    description: 'One structured call to a language model. Compiles to a Plugin invocation against the AI Harness.',
    primitives: 'Plugin',
    defaults: () => ({
      title: 'Model Call',
      key: 'completion',
      scope: '$',
      model: 'claude-sonnet-5',
      prompt: '',
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
    tagline: 'Callable capability',
    description: 'A capability an agent (or the flow) can invoke. Compiles to a Plugin or Extrinsic call.',
    primitives: 'Plugin · Extrinsic',
    defaults: () => ({ title: 'Tool', key: 'toolResult', scope: '$', name: '', schema: {} }),
    preview: (d) => String(d.name || 'unbound tool'),
  }),
  retriever: spec({
    kind: 'retriever',
    type: 'retriever',
    label: 'Retriever',
    icon: 'node-retriever',
    color: '#0ea5e9',
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
    tagline: 'Read / write memory',
    description: 'Persist or recall conversation and working memory. Compiles to a Plugin store plus Code merge.',
    primitives: 'Plugin · Code',
    defaults: () => ({ title: 'Memory', key: 'memory', scope: '$', op: 'read', namespace: 'default' }),
    preview: (d) => `${String(d.op ?? 'read')} · ${String(d.namespace ?? '')}`,
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
    tagline: 'Branch on a rule',
    description:
      'Evaluate a rule and fire the matching branch(es). Compiles directly to a Contract; every branch/switch/router is one.',
    primitives: 'Contract',
    branching: true,
    defaults: () => ({
      title: 'Condition',
      key: 'decision',
      scope: '$',
      language: 'javascript',
      source: "// return an array of tags to fire matching branches\nreturn ['default']\n",
      tags: ['default'],
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
  loop: spec({
    kind: 'loop',
    type: 'loop',
    label: 'Loop',
    icon: 'node-loop',
    color: '#7c3aed',
    group: 'logic',
    tagline: 'Iterate until done',
    description:
      'Repeat a sub-path until a success condition holds — agent turns, self-review, retries. A native Loop system compiling to GoTo + Contract.',
    primitives: 'GoTo · Contract',
    defaults: () => ({ title: 'Loop', key: 'iteration', scope: '$', until: 'done', maxIterations: 10 }),
    preview: (d) => `until ${String(d.until ?? 'done')}`,
  }),
  approval: spec({
    kind: 'approval',
    type: 'approval',
    label: 'Human Approval',
    icon: 'node-approval',
    color: '#a855f7',
    group: 'logic',
    tagline: 'Human in the loop',
    description: 'Pause for a human decision, then continue. Compiles to a Plugin gate inside a Loop system.',
    primitives: 'Plugin · Loop',
    branching: true,
    defaults: () => ({ title: 'Human Approval', key: 'approval', scope: '$', prompt: 'Approve this step?', tags: ['approved', 'rejected'] }),
    preview: (d) => (Array.isArray(d.tags) ? (d.tags as string[]).join(' / ') : 'approved / rejected'),
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
    color: '#0284c7',
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
      'Hand execution to a live external process with its own state, connections and UI. The most powerful primitive — the escape hatch to the outside world.',
    primitives: 'Plugin',
    defaults: () => ({ title: 'Plugin', key: 'output', scope: '$', pluginId: '', action: '', settings: {} }),
    preview: (d) => String(d.pluginId || 'unbound plugin'),
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

  // ---- Output ----
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
  { id: 'ai', label: 'AI Harness', kinds: ['agent', 'model', 'tool', 'retriever', 'memory', 'guardrail'] },
  { id: 'logic', label: 'Logic & Flow', kinds: ['condition', 'transform', 'loop', 'approval', 'merge'] },
  { id: 'io', label: 'Integrations', kinds: ['http', 'extrinsic', 'plugin', 'subflow', 'output'] },
]

export const NODE_LIST: NodeSpec[] = Object.values(NODE_SPECS)

/** The node a fresh workflow starts with. */
export const DEFAULT_START_KIND: NodeKind = 'trigger'

export function specForType(type: string): NodeSpec | undefined {
  return NODE_SPECS[type as NodeKind]
}
