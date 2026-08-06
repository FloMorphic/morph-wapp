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
 *
 * `scope` is a real JSONPath — expressions and filter queries included, not just
 * dotted paths — and it decides how many times the node runs. A scope that
 * selects ONE value runs the node once against it. A scope that selects MANY
 * (`$.data[*]`, `$.orders[?(@.total > 100)]`) fans out: the runtime runs the node
 * once per selected element, each pass seeing only that element as its scope.
 * So the same node is a single step or a loop over a collection depending on
 * nothing but its scope — there is no separate iterator node.
 */

// The HITL node's starter prompt lives with the rest of its contract in
// lib/hitl. That module only imports this one for a type, which erases, so
// there is no runtime cycle.
import { DEFAULT_HITL_PROMPT } from '@/lib/hitl'

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
  | 'http'
  // Not a builtin: one action of an imported inflowv1 plugin. Every such node
  // shares this single kind — what it does is decided by the `pluginId` +
  // `action` stamped on its data when it was dragged from the palette, and by
  // the form the plugin advertised for that action. See the `plugin` spec.
  | 'plugin'

/** `plugins` is not a builtin tab: it is the palette section fed by imported
 *  plugins, listed separately (and searchably) because its contents come from
 *  the registry rather than this catalog. */
export type PaletteGroupId = 'flow' | 'ai' | 'stores' | 'integrations' | 'human' | 'plugins'

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
  /**
   * Route tags every edge leaving this port must carry (`edge.data.tags`).
   * The engine routes purely by tag — it compares the tags a node fires against
   * the tags on its outbound edges — and never looks at the source node's own
   * config, so a port that means something (an LLM function) has to push its
   * tag onto the edges drawn from it. Leave undefined for a port that doesn't
   * dictate tags; the edge then keeps whatever tags it already has.
   */
  tags?: string[]
  /**
   * Marks a port that isn't a normal branch of the node's work but its escape
   * hatch — the fallback the plugin fires when it errors or can't decide. It
   * renders in the danger tone with an `exception` label so a designer can tell
   * it apart from the ports they defined. See {@link exceptionPort}.
   */
  variant?: 'exception'
  /** Tooltip explaining what routes through this port (hover on the node). */
  hint?: string
  /**
   * The designer's own note on what this branch is for. Unlike {@link hint} it is
   * rendered on the port card itself (under the tag + title line), so a reader of
   * the canvas sees what each branch means without hovering.
   */
  description?: string
}

/**
 * The hardcoded route tag of a node's exception port. The plugin side fires
 * this exact tag when it hits an error or an unknown mode, so the flow carries
 * on through whatever the designer wired to that port instead of stopping.
 * Being plugin-side and fixed, it is never derived from user config — the port
 * stamps it onto every edge drawn from it (see {@link portTags}).
 */
export const EXCEPTION_TAG = '_exception'

/**
 * The exception port itself. Its handle id doubles as the tag, so an edge's
 * `sourceHandle` alone identifies it. Appended to a node's derived ports: a
 * node with routed ports loses the plain default handle, and without this the
 * flow would have nowhere to go when the plugin fails. A factory, like every
 * other port — its `tags` end up on edge data, which must not alias a shared
 * array.
 */
export const exceptionPort = (): NodePort => ({
  id: EXCEPTION_TAG,
  label: 'Exception, Unknown',
  hint:
    'Routes here when an exception or an unknown circumstance occurs — anything outside the function selection, e.g. the plugin errors or the model picks no bound function. The flow continues into this branch instead of stopping. Present only while functions are bound.',
  tags: [EXCEPTION_TAG],
  variant: 'exception',
})

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
  /**
   * How derived ports render on the node. 'bottom' (default) spreads handles
   * along the bottom edge — fine for a handful of branches. 'stack' renders one
   * full-width card per port under the node body, each with its own right-side
   * outbound handle — scales to many ports (e.g. an MCP server exposing 10+ tools).
   */
  portLayout?: 'bottom' | 'stack'
}

const spec = (s: NodeSpec): NodeSpec => s

/** Coerce an unknown array-of-objects field to a typed list (defensive). */
function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : []
}

/**
 * The route tags a Contract handler fires. `name` is what the drawer edits — one
 * tag per branch, like an LLM function's name — and it is mirrored into `tags`,
 * the shape the engine and the compiler read. Handlers authored before the name
 * existed carry `tags` only (possibly several), so they keep routing off those.
 */
export function handlerTags(h: Record<string, unknown>): string[] {
  const name = String(h.name ?? '').trim()
  if (name) return [name]
  return (Array.isArray(h.tags) ? (h.tags as unknown[]) : []).map((t) => String(t).trim()).filter(Boolean)
}

/** A handler's name as the drawer edits it — legacy rows fall back to their first tag. */
export function handlerName(h: Record<string, unknown>): string {
  return handlerTags(h)[0] ?? ''
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
      // Init messages: an optional system + user message that seed the
      // conversation on the first run. Each content may embed {{$.path}} context
      // vars. Empty boxes are not stored. Sent to the plugin as body.messages.
      body: { messages: [] },
      // [{ id, name, title, description, params, parameters }] — each renders as
      // an output port (see ports()). `params` are the drawer's argument rows and
      // `parameters` the JSON Schema built from them, which is what the compiler
      // ships to the plugin (see NodeConfig's Functions section).
      functions: [],
    }),
    preview: (d) => {
      const n = asRows(d.functions).length
      return n ? `${n} function${n === 1 ? '' : 's'}` : 'no functions'
    },
    // Bound functions can grow numerous, so they render as stacked cards under
    // the node body (one right-side outbound handle each), not a bottom row.
    portLayout: 'stack',
    // A function's `name` is its route tag: when the model calls the tool, the
    // llm plugin fires that exact name as the next-filter tag, so the edge off
    // this port carries it (see portTags / WorkflowCanvas) or the branch never
    // runs. `title` is a canvas label only.
    //
    // Binding functions replaces the node's plain default handle with these
    // ports, so the exception port is appended to give the flow somewhere to go
    // when the plugin errors or hits an unknown mode — it fires `_exception`
    // and the designer's handling branch continues from there. Unbound (no
    // functions) the node keeps its single untagged handle, which already takes
    // every outcome, so there is nothing to fall back from.
    ports: (d) => {
      const fns = asRows(d.functions)
      if (fns.length === 0) return []
      return [
        ...fns.map((f, i) => ({
          id: String(f.id ?? f.name ?? `fn${i}`),
          label: String(f.title ?? '').trim() || String(f.name ?? '').trim() || `fn${i + 1}`,
          description: String(f.description ?? '').trim() || undefined,
          tags: [String(f.name ?? '').trim()].filter(Boolean),
        })),
        exceptionPort(),
      ]
    },
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
      'Evaluate a rule (JavaScript or OPA/Rego) over the scoped context and route through matching handlers. The scoped slice arrives as `input`; in JavaScript the LAST EXPRESSION is the decision (not a `return`), in Rego it is the variable named by the result variable. Compiles to a Contract; each handler is an output port for a routed branch.',
    primitives: 'Contract',
    defaults: () => ({
      title: 'Rule',
      key: 'decision',
      scope: '$',
      lang: 'js',
      // Same evaluation model as the JS node: `input` in, last expression out.
      logic_rule: 'let scopedData = input // the slice selected by `scope`\n\nlet decision = { pass: true }\n\ndecision // last expression — this is the routed decision\n',
      opa_result: '',
      // [{ key, value }]
      conditions: [],
      // [{ id, name, title, color, tags }] — each renders as an output port (see
      // ports()). `name` is the branch's route tag, mirrored into `tags` (the
      // shape the engine reads); `title` is a canvas label only. Same split as an
      // LLM function's name / title, minus the description — a contract branch is
      // chosen by the rule's own code, so there is no model to describe it to.
      handlers: [],
    }),
    preview: (d) => {
      const n = asRows(d.handlers).length
      return `${String(d.lang ?? 'js')} · ${n} handler${n === 1 ? '' : 's'}`
    },
    // Handlers stack as cards, like the LLM's functions: their branches lead
    // rightward, and a right-side handle per handler sends each edge straight at
    // its target instead of dropping it off the bottom edge to curve back up
    // across its siblings.
    portLayout: 'stack',
    // A handler's `name` is its route tag, exactly like an LLM function's name:
    // the contract fires the tags its matching handler declares and only edges
    // carrying one of them continue, so the port has to stamp them onto its
    // outbound edges (see portTags / WorkflowCanvas) or the branch never runs.
    // A fresh handler with no name yet stamps an empty list — same as an unnamed
    // LLM function — rather than leaving a stale tag on the edge.
    ports: (d) =>
      asRows(d.handlers).map((h, i) => {
        const tags = handlerTags(h)
        return {
          id: String(h.id ?? `h${i}`),
          label: String(h.title ?? '').trim() || tags.join(' / ') || `branch ${i + 1}`,
          tags,
        }
      }),
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
      'Connect to an MCP server as a client. In "Tool only" mode it calls a single tool; in "With LLM" mode it drives a model (provider config from a settings profile) that binds and calls the loaded tools internally — tool routing never surfaces as workflow edges. Connection params (URL, transport, auth) are set on the node. Compiles to a Plugin node.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'MCP',
      key: 'mcp',
      scope: '$',
      subject_prefix: 'mcp',
      idle_min: 5,
      // The plugin action the backend invokes — kept in lockstep with mcpMode by
      // NodeConfig: 'tool' → 'call_tool' (call one tool, no LLM), 'llm' → 'run'
      // (drive a model over the tools). Default mode is 'tool', so default here.
      request: 'call_tool',
      // 'tool' = expose the MCP server's tools to the flow only; 'llm' = drive a
      // model with those tools (LLM-like: prompt + provider settings profile).
      mcpMode: 'tool',
      // Only used in 'llm' mode — the init messages (system/user) that seed the
      // agent's conversation on its first run. Sent to the plugin as body.messages.
      body: { messages: [] },
      url: '',
      transport: 'streamable-http',
      auth: '',
      // [{ id, name, title, description, inputSchema }] — loaded from the MCP
      // server via the "load tools" button and listed in the drawer only: the
      // plugin binds and calls tools internally, so they are not workflow ports;
      // inputSchema drives the argument dialog for 'tool' mode's call_tool.
      functions: [],
      // 'tool' mode (call_tool) only: the single tool to call and the arguments
      // to call it with (shaped by that tool's inputSchema).
      tool: '',
      arguments: {},
    }),
    preview: (d) => {
      const mode = d.mcpMode === 'llm' ? 'with LLM' : 'tools'
      const n = asRows(d.functions).length
      const tools = n ? `${n} tool${n === 1 ? '' : 's'}` : d.url ? 'no tools loaded' : 'no server'
      return `${mode} · ${tools}`
    },
    // No derived ports: the plugin binds and calls MCP tools as an innate
    // operation in both modes, so the node carries the single default handle
    // and its tools are only listed in the drawer.
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
      'Run a JavaScript step against the scoped context and write the result back to `key`. The scoped slice arrives as `input`, and the value of the LAST EXPRESSION in the code is the node output — not a `return` statement. Compiles to a Code node (variant `js`) in the Inflowenger ecosystem.',
    primitives: 'Code · js',
    defaults: () => ({
      title: 'JS',
      key: 'result',
      scope: '$',
      lang: 'js',
      // No `return` — the runtime evaluates the code and takes the value of its
      // last expression as the node output, so the code ends by naming the
      // value to emit. `input` is the scoped slice (see the `scope` note in the
      // module header).
      logic_rule: 'let scopedData = input // the slice selected by `scope`\n\nlet result = { ok: true, seen: scopedData }\n\nresult // last expression — this is what lands in `key`\n',
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
      'Evaluate an OPA/Rego policy against the scoped context and write the selected result back to `key`. Inside the policy the given scope is accessible through the `input` key (e.g. `input.<field in scope>`), and the key/value pairs defined in Conditions are accessible through the `data` key (e.g. `data.<condition key>`). Try your policy in the playground: https://play.openpolicyagent.org. Compiles to a Code node (variant `opa`) in the Inflowenger ecosystem.',
    primitives: 'Code · opa',
    defaults: () => ({
      title: 'OPA',
      key: 'result',
      scope: '$',
      lang: 'opa',
      logic_rule:
        'scope_data := input # the scoped context — fields selected by `scope` are available as input.<field>\n' +
        'criteria := data # values coming from the Conditions key/value pairs — available as data.<key>\n\n' +
        'result := true\n',
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

  // ---- Integrations ----
  http: spec({
    kind: 'http',
    type: 'http',
    label: 'HTTP',
    icon: 'node-http',
    color: '#0d9488',
    group: 'integrations',
    tagline: 'Call an external API',
    description:
      'Make an HTTP request to an external API and write the response back to `key`. The method, URL, headers, query params and request body are set on the node; each may embed {{$.path}} context vars, resolved at run time. Compiles to a Plugin node.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'HTTP',
      key: 'response',
      scope: '$',
      subject_prefix: 'http',
      idle_min: 5,
      request: 'run',
      // Shipped to the http plugin verbatim as body (see the backend NODE_HTTP
      // compiler case) — matches the plugin's RunBody contract. headers / query
      // are [{ key, value }] rows the drawer edits; body_type (json|form|text)
      // sets the default Content-Type when a body is present.
      body: { method: 'GET', url: '', headers: [], query: [], body: '', body_type: 'json' },
    }),
    preview: (d) => {
      const b = (d.body ?? {}) as Record<string, unknown>
      const method = String(b.method ?? 'GET')
      const url = String(b.url ?? '').trim()
      return url ? `${method} ${url}` : `${method} — no url`
    },
  }),

  // ---- Imported plugins ----
  // One spec for every action of every imported plugin. The builtins above each
  // describe one fixed node; this one is a shell whose behaviour arrives with
  // the node — `pluginId` and `action` say which plugin method to call, and the
  // action's own form (stamped as `form`) says which fields the drawer shows.
  // That is why its label and icon are so generic: they are only ever seen
  // before a real action fills them in.
  plugin: spec({
    kind: 'plugin',
    type: 'plugin',
    label: 'Plugin action',
    icon: 'plugin',
    color: '#8b2fe0',
    group: 'plugins',
    tagline: 'An imported plugin action',
    description:
      'One action of an inflowv1 plugin imported through Extensions. Its fields come from the form the plugin advertises for that action, and its runtime config from a settings profile shared by every node of the plugin. Compiles to a Plugin node calling that action.',
    primitives: 'Plugin',
    plugin: true,
    defaults: () => ({
      title: 'Plugin action',
      key: 'result',
      scope: '$',
      // Stamped from the palette row: which plugin, which method.
      pluginId: '',
      action: '',
      // The action's advertised form ({ schema, ui }), carried on the node so
      // the drawer renders without asking the plugin again — a plugin that is
      // temporarily down must not make its nodes uneditable.
      form: { schema: {}, ui: {} },
      // The values collected through that form; shipped to the plugin verbatim.
      body: {},
      // Declared branch ports stamped from the palette row (SDK Action.Outbound):
      // [{ title, tags, description }]. Each renders as an output port (see
      // ports()); empty/absent means the node keeps a single default source
      // handle. Only plugin nodes whose action advertised outbound carry any.
      outbound: [],
      idle_min: 5,
    }),
    preview: (d) => String(d.action || 'no action'),
    // Plugin actions may advertise outbound ports (SDK Action.Outbound). When
    // present they stack as cards like a Contract's handlers, each sending its
    // edges rightward at their target. A plugin fires the tag(s) it wants at
    // runtime via `next_tags` (job.CmdNextFilter), so — exactly as with a Rule —
    // each port has to stamp its tags onto the edges drawn from it, or the branch
    // never runs. An action with no outbound derives no ports, so the node falls
    // back to the single default source handle it has always had.
    portLayout: 'stack',
    ports: (d) =>
      asRows(d.outbound).map((p, i) => {
        // An outbound entry carries its full tag list (unlike a Contract
        // handler's single `name`), so route off `tags` verbatim.
        const tags = (Array.isArray(p.tags) ? (p.tags as unknown[]) : [])
          .map((t) => String(t).trim())
          .filter(Boolean)
        const title = String(p.title ?? '').trim()
        return {
          id: title || tags.join(' / ') || `out${i}`,
          label: title || tags.join(' / ') || `branch ${i + 1}`,
          tags,
          description: String(p.description ?? '').trim() || undefined,
        }
      }),
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
      'Hand the flow to a person when it cannot settle something itself. The prompt tells the session what to establish — read from the run’s own context — and the questions come out of the conversation, not the canvas. Either park the run until the person is done (it resumes from here) or record the task and carry on. Compiles to an Extrinsic against the backend `hitl` service (`svc.hitl.add`), which records a Human Task surfaced under Operate → Human Task.',
    primitives: 'Extrinsic · svc.hitl.add',
    defaults: () => ({
      title: 'Human in the Loop',
      key: 'humanReply',
      scope: '$',
      // See lib/hitl for what each of these means on the wire. `park` and
      // `direct` are the defaults because they are the behaviour that exists
      // end to end today: stop the run here, answer it in the app.
      mode: 'park',
      // A fresh node opens with the starter prompt rather than a blank box: the
      // prompt IS the node's configuration, so an empty one is a node that does
      // nothing, and the default doubles as the explanation of what to write.
      prompt: DEFAULT_HITL_PROMPT,
      channel: 'direct',
    }),
    preview: (d) => {
      const mode = d.mode === 'continue' ? 'continue' : 'park'
      const opener = String(d.prompt ?? '').trim().split('\n')[0]
      return `${mode} · ${opener || 'no prompt'}`
    },
  }),
}

export const PALETTE_GROUPS: { id: PaletteGroupId; label: string; kinds: NodeKind[] }[] = [
  { id: 'flow', label: 'Flow', kinds: ['startNode', 'promissall', 'until', 'goto'] },
  { id: 'ai', label: 'AI & Logic', kinds: ['llm', 'mcp', 'rule', 'js', 'opa'] },
  { id: 'stores', label: 'Stores', kinds: ['docstore', 'vecstore', 'cast'] },
  { id: 'integrations', label: 'Integrations', kinds: ['http'] },
  { id: 'human', label: 'Human', kinds: ['hitl'] },
]

export const NODE_LIST: NodeSpec[] = Object.values(NODE_SPECS)

/** The node a fresh workflow starts with. */
export const DEFAULT_START_KIND: NodeKind = 'startNode'

export function specForType(type: string): NodeSpec | undefined {
  return NODE_SPECS[type as NodeKind]
}

/**
 * The route tags an edge leaving `handleId` of `node` has to carry, or
 * undefined when that port doesn't dictate any (a plain handle, or a node kind
 * whose ports carry no tags) and the edge's own tags should be left alone.
 *
 * Ports are derived from node data, so this is re-read whenever an edge is
 * drawn, re-wired or saved: rename an LLM function and every edge already drawn
 * from it picks the new name up.
 */
export function portTags(
  node: { type?: string; data?: unknown } | undefined,
  handleId?: string | null,
): string[] | undefined {
  if (!node || !handleId) return undefined
  const spec = specForType(String(node.type ?? ''))
  const port = spec?.ports?.(node.data as BaseNodeData)?.find((p) => p.id === handleId)
  return port?.tags
}
