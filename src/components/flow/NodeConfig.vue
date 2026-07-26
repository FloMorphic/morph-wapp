<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import CodeEditor from '@/components/ui/CodeEditor.vue'
import JsonSchemaForm from '@/components/flow/JsonSchemaForm.vue'
import { flowsApi } from '@/api/flows'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import type { FlowRecord, McpTool } from '@/types/api'

/**
 * Tailored configuration editor for the code / logic / LLM nodes, mirroring the
 * Inflowenger inspector's Code and Contract drawers:
 *
 *   js     → a JavaScript code editor.
 *   opa    → an OPA/Rego editor + result variable + criteria conditions.
 *   rule   → a Contract: JS or OPA code (+ result var / conditions) plus routed
 *            output handlers — each handler renders as an outbound port.
 *   llm    → prompt template + bound functions — each function renders as an
 *            outbound port the model can route through.
 *
 * It edits the selected node's reactive `data` in place; the canvas (FlowNode)
 * re-derives its output ports from `data.handlers` / `data.functions` live.
 */
const props = defineProps<{ node: GraphNode }>()

function data(): Record<string, unknown> {
  return props.node.data as Record<string, unknown>
}

const type = computed(() => props.node.type)
const isCode = computed(() => ['js', 'opa', 'rule'].includes(type.value))
const isLlm = computed(() => type.value === 'llm')
const isMcp = computed(() => type.value === 'mcp')
const isGoto = computed(() => type.value === 'goto')
const isUntil = computed(() => type.value === 'until')
const showLangToggle = computed(() => type.value === 'rule')
const lang = computed<string>({
  get: () => {
    if (type.value === 'js') return 'js'
    if (type.value === 'opa') return 'opa'
    return (data().lang as string) || 'js'
  },
  set: (v) => {
    data().lang = v
  },
})
const showResultVar = computed(() => lang.value === 'opa')
const showConditions = computed(() => type.value === 'opa' || type.value === 'rule')
const showHandlers = computed(() => type.value === 'rule')

// ---- Conditions ({ key, value }[]) ----------------------------------------
interface Condition {
  key: string
  value: string
}
function conditions(): Condition[] {
  if (!Array.isArray(data().conditions)) data().conditions = []
  return data().conditions as Condition[]
}
function addCondition() {
  conditions().push({ key: '', value: '' })
}
function removeCondition(i: number) {
  conditions().splice(i, 1)
}

// ---- Handlers ({ id, tags[], color }[]) — routed output ports --------------
interface Handler {
  id: string
  tags: string[]
  color: string
}
const HANDLER_COLORS = ['#8b2fe0', '#16a34a', '#d97706', '#e11d48', '#0ea5e9', '#64748b']
function handlers(): Handler[] {
  if (!Array.isArray(data().handlers)) data().handlers = []
  return data().handlers as Handler[]
}
function addHandler() {
  const color = HANDLER_COLORS[handlers().length % HANDLER_COLORS.length]
  handlers().push({ id: `h-${Date.now()}`, tags: [], color })
}
function removeHandler(i: number) {
  handlers().splice(i, 1)
}
/** Edit a handler's tags as a comma-separated string. */
function handlerTags(h: Handler): string {
  return (h.tags ?? []).join(', ')
}
function setHandlerTags(h: Handler, raw: string) {
  h.tags = raw.split(',').map((t) => t.trim()).filter(Boolean)
}

// ---- LLM functions ({ id, name, title, description }[]) — routed output ports
// `name` is the tool name AND the outbound-port route tag; `description` is the
// model-facing text that tells the LLM when to call it (required — the model
// picks tools by their description); `title` is a canvas display label only.
interface Fn {
  id: string
  name: string
  title: string
  description: string
  // MCP tools carry their JSON-schema arguments so 'tool' mode can build the
  // call_tool argument dialog; hand-declared LLM functions leave it undefined.
  inputSchema?: Record<string, unknown>
}
function functions(): Fn[] {
  if (!Array.isArray(data().functions)) data().functions = []
  return data().functions as Fn[]
}
function addFunction() {
  functions().push({ id: `fn-${Date.now()}`, name: '', title: '', description: '' })
}
function removeFunction(i: number) {
  functions().splice(i, 1)
}

// ---- LLM / MCP init messages (stored on data.body.messages) ----------------
// Both the LLM node and the MCP node's "With LLM" mode seed their conversation
// from an INIT template of at most two messages — a system message (index 0)
// and/or a user message (index 1). Either may be left empty (an empty box is not
// seated), and the content may embed {{$.path}} context vars. The plugin uses
// these only to seed the FIRST run; once the node's scope holds a conversation,
// the template is ignored — so they are never re-added on a resumed/looping run.
// Compiled straight through to the plugin's body.messages array.
type ChatRole = 'system' | 'user'
interface ChatMsg {
  role: ChatRole
  content: string
}
// Order the two messages are stored (and read by the model) in.
const ROLE_ORDER: Record<ChatRole, number> = { system: 0, user: 1 }

function llmBody(): Record<string, unknown> {
  const body = (data().body as Record<string, unknown>) ?? {}
  data().body = body
  return body
}

// The messages array, migrating a legacy single `body.prompt` (previously the
// user turn) to a user message on first read.
function messages(): ChatMsg[] {
  const body = llmBody()
  if (!Array.isArray(body.messages)) {
    const legacy = typeof body.prompt === 'string' ? body.prompt : ''
    body.messages = legacy ? [{ role: 'user', content: legacy }] : []
    delete body.prompt
  }
  return body.messages as ChatMsg[]
}

function msgContent(role: ChatRole): string {
  return messages().find((m) => m.role === role)?.content ?? ''
}
// Write one role's box: upsert while it has text, drop it once cleared — so an
// empty box never lands in body.messages. Order stays system → user.
function setMsgContent(role: ChatRole, v: string) {
  const body = llmBody()
  const msgs = messages()
  const existing = msgs.find((m) => m.role === role)
  if (v.trim() === '') {
    if (existing) body.messages = msgs.filter((m) => m.role !== role)
    return
  }
  if (existing) {
    existing.content = v
    return
  }
  msgs.push({ role, content: v })
  msgs.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
}

const systemMsg = computed<string>({
  get: () => msgContent('system'),
  set: (v) => setMsgContent('system', v),
})
const userMsg = computed<string>({
  get: () => msgContent('user'),
  set: (v) => setMsgContent('user', v),
})

// ---- MCP node -------------------------------------------------------------
// The MCP node has two modes, chosen with an option toggle:
//   'tool' → expose the MCP server's tools to the flow (client only).
//   'llm'  → drive a model over those tools (LLM-like: prompt + provider profile
//            + bound functions). Connection params live on data.url/transport/auth
//            and are compiled into the plugin body (see the backend compiler).
type McpMode = 'tool' | 'llm'
const MCP_TRANSPORTS: { value: string; label: string }[] = [
  { value: 'streamable-http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'stdio', label: 'stdio' },
  { value: 'websocket', label: 'WebSocket' },
]

const mcpMode = computed<McpMode>({
  get: () => ((data().mcpMode as McpMode) === 'llm' ? 'llm' : 'tool'),
  set: (v) => {
    data().mcpMode = v
    // Keep the invoked plugin action in lockstep with the mode: 'llm' → the
    // agentic `run`, 'tool' → the single-shot `call_tool`.
    data().request = v === 'llm' ? 'run' : 'call_tool'
  },
})
// The single tool call_tool invokes ('tool' mode).
const mcpTool = computed<string>({
  get: () => (data().tool as string) || '',
  set: (v) => {
    data().tool = v
    // A different tool means a different argument shape — start clean.
    data().arguments = {}
  },
})
// The selected tool's loaded function entry and its JSON-schema, which drives
// the generated argument form (inspector-style). No usable schema → JSON only.
const selectedMcpFn = computed(() => functions().find((f) => f.name === mcpTool.value))
const mcpToolSchema = computed<Record<string, unknown> | null>(() => {
  const s = selectedMcpFn.value?.inputSchema
  const properties = s && typeof s === 'object' ? (s as { properties?: object }).properties : undefined
  return properties && Object.keys(properties).length ? (s as Record<string, unknown>) : null
})
// call_tool arguments: edited via the schema-generated form when the tool's
// inputSchema allows it, or as raw JSON (the only view for schema-less tools).
const mcpArgsView = ref<'form' | 'json'>('form')
const mcpArgs = computed(() => {
  const a = data().arguments
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {}
})
function onMcpArgsFormUpdate(v: unknown) {
  data().arguments = v && typeof v === 'object' ? v : {}
}
const mcpArgsText = ref('')
const mcpArgsError = ref<string | null>(null)
function syncMcpArgsText() {
  const args = data().arguments
  mcpArgsText.value = args && Object.keys(args as object).length ? JSON.stringify(args, null, 2) : ''
  mcpArgsError.value = null
}
watch(
  () => [props.node?.id, data().tool],
  () => {
    syncMcpArgsText()
    mcpArgsView.value = 'form'
  },
  { immediate: true },
)
// Entering the JSON view shows whatever the form built so far.
watch(mcpArgsView, (v) => {
  if (v === 'json') syncMcpArgsText()
})
function onMcpArgsInput(v: string) {
  mcpArgsText.value = v
  if (!v.trim()) {
    data().arguments = {}
    mcpArgsError.value = null
    return
  }
  try {
    data().arguments = JSON.parse(v)
    mcpArgsError.value = null
  } catch (e) {
    mcpArgsError.value = (e as Error).message
  }
}
const mcpUrl = computed<string>({
  get: () => (data().url as string) || '',
  set: (v) => {
    data().url = v
  },
})
const mcpTransport = computed<string>({
  get: () => (data().transport as string) || 'streamable-http',
  set: (v) => {
    data().transport = v
  },
})
const mcpAuth = computed<string>({
  get: () => (data().auth as string) || '',
  set: (v) => {
    data().auth = v
  },
})

// "Load tools" — connect to the configured MCP server (via the backend inflowv1
// proxy) and bind one function per advertised tool. Existing function ids are
// reused for tools that are still present so their output-port edges survive a
// reload; tools that disappear are dropped.
const mcpLoading = ref(false)
const mcpError = ref<string | null>(null)
const mcpLoadedAt = ref<number | null>(null)

async function loadMcpTools() {
  const pluginId = String(data().pluginId ?? '')
  if (!pluginId) {
    mcpError.value = 'This MCP node has no plugin id — drop it from the palette (needs a running backend) to load tools.'
    return
  }
  if (!mcpUrl.value.trim()) {
    mcpError.value = 'Set the MCP server URL first.'
    return
  }
  mcpLoading.value = true
  mcpError.value = null
  try {
    const tools = await nodeRegistryApi.mcpTools(pluginId, {
      url: mcpUrl.value.trim(),
      transport: mcpTransport.value,
      auth: mcpAuth.value.trim() || undefined,
    })
    const existing = functions()
    data().functions = (tools ?? []).map((t: McpTool) => {
      const prior = existing.find((f) => f.name === t.name)
      return {
        id: prior?.id ?? `fn-${t.name}-${Date.now()}`,
        name: t.name,
        title: t.title || t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
      }
    })
    // The previously selected tool may have vanished from the server — drop the
    // stale selection (and its arguments) rather than calling a ghost tool.
    if (mcpTool.value && !functions().some((f) => f.name === mcpTool.value)) {
      mcpTool.value = ''
    }
    mcpLoadedAt.value = Date.now()
  } catch (err) {
    mcpError.value = (err as Error).message
  } finally {
    mcpLoading.value = false
  }
}

// ---- Code (logic_rule) -----------------------------------------------------
const code = computed<string>({
  get: () => (data().logic_rule as string) || '',
  set: (v) => {
    data().logic_rule = v
  },
})
const opaResult = computed<string>({
  get: () => (data().opa_result as string) || '',
  set: (v) => {
    data().opa_result = v
  },
})

// ---- Continue After (until) ------------------------------------------------
// The schedule is either a relative delay — a unit (`mode`) times an amount
// (`value`) — or an absolute date/time (`mode === 'at'`, held in `at`). Both
// resolve to a single unix time downstream: the backend compiler turns `at`
// into an absolute epoch and a delay into `delaySeconds`, and the continue.at
// svc handler schedules the resumed process from it.
type UntilMode = 'seconds' | 'minutes' | 'hour' | 'day' | 'at'
const UNTIL_UNITS: { id: UntilMode; label: string }[] = [
  { id: 'seconds', label: 'Seconds' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'hour', label: 'Hours' },
  { id: 'day', label: 'Days' },
]

const untilMode = computed<UntilMode>({
  get: () => (data().mode as UntilMode) || 'hour',
  set: (v) => {
    data().mode = v
  },
})
const untilValue = computed<number>({
  get: () => {
    const v = Number(data().value)
    return Number.isFinite(v) ? v : 0
  },
  set: (v) => {
    data().value = Number(v) || 0
  },
})
const untilAt = computed<string>({
  get: () => (data().at as string) || '',
  set: (v) => {
    data().at = v
  },
})

// ---- Goto ({ flowId, from_nodeId, end_nodeId } + titles) --------------------
// Mirrors the Inflowenger inspector's Goto drawer: pick a target flow, then a
// from / end node from that flow's nodes.
interface GotoData {
  flowId: string
  flowTitle?: string
  from_nodeId: string
  from_nodeTitle?: string
  end_nodeId: string
  end_nodeTitle?: string
}
interface NodeOption {
  id: string
  label: string
}

const route = useRoute()
const currentFlowId = computed(() => String(route.params.id ?? ''))

const flows = ref<FlowRecord[]>([])
const flowsLoading = ref(false)
const targetNodes = ref<NodeOption[]>([])
const nodesLoading = ref(false)

function goto(): GotoData {
  const g = data().goto
  if (!g || typeof g !== 'object') {
    data().goto = { flowId: '', from_nodeId: '', end_nodeId: '' }
  }
  return data().goto as GotoData
}

const gotoFlowId = computed<string>({
  get: () => goto().flowId || '',
  set: (id) => {
    const g = goto()
    g.flowId = id
    g.flowTitle = flows.value.find((f) => f.id === id)?.title ?? ''
    // Reset node selections when the target flow changes.
    g.from_nodeId = ''
    g.from_nodeTitle = ''
    g.end_nodeId = ''
    g.end_nodeTitle = ''
    loadTargetNodes(id)
  },
})
const gotoFrom = computed<string>({
  get: () => goto().from_nodeId || '',
  set: (id) => {
    const g = goto()
    g.from_nodeId = id
    g.from_nodeTitle = targetNodes.value.find((n) => n.id === id)?.label ?? ''
  },
})
const gotoEnd = computed<string>({
  get: () => goto().end_nodeId || '',
  set: (id) => {
    const g = goto()
    g.end_nodeId = id
    g.end_nodeTitle = targetNodes.value.find((n) => n.id === id)?.label ?? ''
  },
})

async function loadTargetNodes(flowId: string) {
  if (!flowId) {
    targetNodes.value = []
    return
  }
  nodesLoading.value = true
  try {
    const rec = await flowsApi.get(flowId)
    targetNodes.value = (rec.view_flow?.nodes ?? []).map((n) => ({
      id: n.id,
      label: (n.data as { title?: string })?.title || n.id,
    }))
  } catch {
    targetNodes.value = []
  } finally {
    nodesLoading.value = false
  }
}

// Load the flow list (and any already-selected target's nodes) for a Goto node.
watch(
  isGoto,
  async (on) => {
    if (!on || flows.value.length) return
    flowsLoading.value = true
    try {
      const page = await flowsApi.list({ per_page: 100 })
      flows.value = page.list
    } catch {
      flows.value = []
    } finally {
      flowsLoading.value = false
    }
    if (gotoFlowId.value) loadTargetNodes(gotoFlowId.value)
  },
  { immediate: true },
)

onMounted(() => {
  if (isGoto.value && gotoFlowId.value) loadTargetNodes(gotoFlowId.value)
})

// Target flows exclude the flow currently being edited (no self-jump by default).
const targetFlows = computed(() => flows.value.filter((f) => f.id !== currentFlowId.value))
</script>

<template>
  <div class="space-y-4">
    <!-- ================= Code / Rule ================= -->
    <template v-if="isCode">
      <!-- Language toggle (Rule supports either; js/opa nodes are fixed) -->
      <div v-if="showLangToggle" class="space-y-1.5">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Language</label>
        <div class="flex gap-2">
          <button
            v-for="opt in (['js', 'opa'] as const)"
            :key="opt"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
            :style="lang === opt
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : { color: 'var(--fg-muted)' }"
            @click="lang = opt"
          >
            <Icon name="node-code" :size="14" />
            {{ opt === 'js' ? 'JavaScript' : 'OPA / Rego' }}
          </button>
        </div>
      </div>

      <!-- Result variable (OPA only) -->
      <div v-if="showResultVar" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Result variable</label>
        <input v-model="opaResult" class="input font-mono text-xs" placeholder="e.g. allow, result, permit" />
        <p class="text-[11px] leading-relaxed text-fg-subtle">
          The Rego variable whose value is shipped as this node's output.
        </p>
      </div>

      <!-- Code editor -->
      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {{ lang === 'opa' ? 'Policy (Rego)' : 'Code (JavaScript)' }}
        </label>
        <CodeEditor
          v-model="code"
          :language="lang === 'opa' ? 'opa' : 'js'"
          inline
          wrap
          :placeholder="lang === 'opa' ? 'package flomorphic\n\nscope_data := input # scoped context: input.<field>\ncriteria := data # Conditions key/values: data.<key>\n\nresult := true' : '// last expression is the result\nreturn { ok: true }'"
        />
      </div>

      <!-- Conditions (OPA criteria / Rule) -->
      <div v-if="showConditions" class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Conditions</label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addCondition">
            <Icon name="plus" :size="13" /> Add
          </button>
        </div>
        <div v-for="(c, i) in conditions()" :key="i" class="flex items-center gap-2">
          <input v-model="c.key" class="input w-32 font-mono text-xs" placeholder="key" />
          <input v-model="c.value" class="input flex-1 font-mono text-xs" placeholder="value" />
          <button
            class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
            @click="removeCondition(i)"
          >
            <Icon name="x" :size="15" />
          </button>
        </div>
        <p v-if="conditions().length === 0" class="text-[11px] text-fg-subtle">No conditions — the code runs as-is.</p>
      </div>

      <!-- Handlers → output ports (Rule) -->
      <div v-if="showHandlers" class="space-y-1.5 border-t pt-3">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Output handlers
            <span class="ml-1 font-normal normal-case text-fg-subtle">— one outbound port each</span>
          </label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addHandler">
            <Icon name="plus" :size="13" /> Add
          </button>
        </div>
        <div v-for="(h, i) in handlers()" :key="h.id" class="flex items-center gap-2">
          <span class="h-3 w-3 shrink-0 rounded-full" :style="{ background: h.color }" />
          <input
            :value="handlerTags(h)"
            class="input flex-1 text-xs"
            placeholder="tags to fire (comma-separated), e.g. done, retry"
            @input="setHandlerTags(h, ($event.target as HTMLInputElement).value)"
          />
          <button
            class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
            @click="removeHandler(i)"
          >
            <Icon name="x" :size="15" />
          </button>
        </div>
        <p v-if="handlers().length === 0" class="text-[11px] text-fg-subtle">
          No handlers yet — add one to expose a routed output port.
        </p>
      </div>
    </template>

    <!-- ================= LLM ================= -->
    <template v-else-if="isLlm">
      <!-- Init messages: an optional system + user message (see LlmMessages block). -->
      <div class="space-y-2">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          Init messages
          <span class="ml-1 font-normal normal-case text-fg-subtle">— seed the conversation</span>
        </label>

        <div class="space-y-1 rounded-lg border p-2">
          <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">System</span>
          <textarea
            v-model="systemMsg"
            rows="4"
            spellcheck="false"
            class="input resize-none font-mono text-xs leading-relaxed"
            placeholder="You are a helpful assistant. {{$.some.context}}"
          />
        </div>

        <div class="space-y-1 rounded-lg border p-2">
          <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">User</span>
          <textarea
            v-model="userMsg"
            rows="5"
            spellcheck="false"
            class="input resize-none font-mono text-xs leading-relaxed"
            placeholder="Summarize this: {{$.input}}"
          />
        </div>

        <p class="text-[11px] leading-relaxed text-fg-subtle">
          These two messages seed the conversation on the <strong>first</strong> run only — either can
          be left empty. Once the node has a conversation they are not re-added. Content may embed
          <code v-pre>{{$.path}}</code> context vars; the provider, key and model come from the Settings
          profile above.
        </p>
      </div>

      <!-- Functions → output ports -->
      <div class="space-y-1.5 border-t pt-3">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Functions
            <span class="ml-1 font-normal normal-case text-fg-subtle">— one outbound port each, tagged by name</span>
          </label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addFunction">
            <Icon name="plus" :size="13" /> Add
          </button>
        </div>
        <div v-for="(f, i) in functions()" :key="f.id" class="space-y-1.5 rounded-lg border p-2">
          <div class="flex items-center gap-2">
            <input v-model="f.name" class="input w-32 font-mono text-xs" placeholder="name" />
            <input v-model="f.title" class="input flex-1 text-xs" placeholder="title" />
            <button
              class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
              @click="removeFunction(i)"
            >
              <Icon name="x" :size="15" />
            </button>
          </div>
          <textarea
            v-model="f.description"
            rows="2"
            class="input w-full text-xs"
            placeholder="description — tell the model when to call this function (required)"
          />
        </div>
        <p v-if="functions().length === 0" class="text-[11px] text-fg-subtle">
          No functions bound — add one and the model can route to its output port.
        </p>
      </div>
    </template>

    <!-- ================= MCP ================= -->
    <template v-else-if="isMcp">
      <!-- Mode: expose the MCP tools only, or drive an LLM over them. -->
      <div class="space-y-1.5">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Mode</label>
        <div class="flex gap-2">
          <button
            v-for="opt in ([{ id: 'tool', label: 'MCP Tool Only' }, { id: 'llm', label: 'MCP With LLM' }] as const)"
            :key="opt.id"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
            :style="mcpMode === opt.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : { color: 'var(--fg-muted)' }"
            @click="mcpMode = opt.id"
          >
            <Icon :name="opt.id === 'llm' ? 'node-llm' : 'node-mcp'" :size="14" />
            {{ opt.label }}
          </button>
        </div>
        <p class="text-[11px] leading-relaxed text-fg-subtle">
          {{ mcpMode === 'llm'
            ? 'Drives a model (provider config from the Settings profile above) that can call the MCP server\'s tools. '
            : 'Exposes the MCP server\'s tools to the flow. No model is called here.' }}
        </p>
      </div>

      <!-- MCP server connection -->
      <div class="space-y-2 border-t pt-3">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">MCP server</label>
        <div class="space-y-1">
          <input v-model="mcpUrl" class="input font-mono text-xs" placeholder="https://mcp.example.com/mcp" />
          <p class="text-[11px] text-fg-subtle">The MCP server endpoint to connect to.</p>
        </div>
        <div class="flex gap-2">
          <select v-model="mcpTransport" class="input flex-1 text-xs" title="Transport">
            <option v-for="t in MCP_TRANSPORTS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <input v-model="mcpAuth" class="input flex-1 font-mono text-xs" placeholder="auth token (optional)" />
        </div>
      </div>

      <!-- With-LLM: init messages (system + user) + tools loaded as functions -->
      <template v-if="mcpMode === 'llm'">
        <div class="space-y-2 border-t pt-3">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Init messages
            <span class="ml-1 font-normal normal-case text-fg-subtle">— seed the conversation</span>
          </label>

          <div class="space-y-1 rounded-lg border p-2">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">System</span>
            <textarea
              v-model="systemMsg"
              rows="4"
              spellcheck="false"
              class="input resize-none font-mono text-xs leading-relaxed"
              placeholder="You are a helpful assistant with access to MCP tools. {{$.some.context}}"
            />
          </div>

          <div class="space-y-1 rounded-lg border p-2">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">User</span>
            <textarea
              v-model="userMsg"
              rows="5"
              spellcheck="false"
              class="input resize-none font-mono text-xs leading-relaxed"
              placeholder="{{$.input}}"
            />
          </div>

          <p class="text-[11px] leading-relaxed text-fg-subtle">
            These two messages seed the agent's conversation on the <strong>first</strong> run only —
            either can be left empty. Once the node has a conversation they are not re-added. Content
            may embed <code v-pre>{{$.path}}</code> context vars; the provider, key and model come from
            the Settings profile above.
          </p>
        </div>

        <!-- Tools the model can call — bound by the plugin internally, so this
             is an informational list only (no workflow ports). -->
        <div class="space-y-1.5 border-t pt-3">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              Tools
              <span class="ml-1 font-normal normal-case text-fg-subtle">— called by the model internally</span>
            </label>
            <button
              class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-60"
              style="border-color: var(--line-strong)"
              :disabled="mcpLoading"
              title="Connect to the MCP server and load its tools"
              @click="loadMcpTools"
            >
              <Icon name="refresh" :size="13" />
              {{ mcpLoading ? 'Loading…' : functions().length ? 'Reload tools' : 'Load tools' }}
            </button>
          </div>

          <p v-if="mcpError" class="text-[12px] text-danger">{{ mcpError }}</p>

          <div v-for="f in functions()" :key="f.id" class="space-y-1 rounded-lg border p-2">
            <div class="flex items-center gap-2">
              <Icon name="node-mcp" :size="13" class="shrink-0 text-fg-subtle" />
              <span class="min-w-0 flex-1 truncate font-mono text-xs text-fg">{{ f.name }}</span>
            </div>
            <p v-if="f.description" class="text-[11px] leading-relaxed text-fg-muted">{{ f.description }}</p>
          </div>

          <p v-if="functions().length === 0" class="text-[11px] text-fg-subtle">
            No tools loaded yet — set the server above and click <em>Load tools</em>. Each tool the
            server advertises becomes available for the model to call internally.
          </p>
        </div>
      </template>

      <!-- Tool-only: pick one tool and set its arguments (call_tool, no LLM) -->
      <template v-else>
        <div class="space-y-1.5 border-t pt-3">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Tool to call</label>
            <button
              class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-60"
              style="border-color: var(--line-strong)"
              :disabled="mcpLoading"
              title="Connect to the MCP server and load its tools"
              @click="loadMcpTools"
            >
              <Icon name="refresh" :size="13" />
              {{ mcpLoading ? 'Loading…' : functions().length ? 'Reload tools' : 'Load tools' }}
            </button>
          </div>

          <p v-if="mcpError" class="text-[12px] text-danger">{{ mcpError }}</p>

          <select v-model="mcpTool" class="input text-xs">
            <option value="">{{ functions().length ? '— select a tool —' : 'No tools loaded' }}</option>
            <option v-for="f in functions()" :key="f.id" :value="f.name">{{ f.title || f.name }}</option>
          </select>
          <p v-if="selectedMcpFn?.description" class="text-[11px] leading-relaxed text-fg-muted">
            {{ selectedMcpFn.description }}
          </p>
          <p v-if="functions().length === 0" class="text-[11px] text-fg-subtle">
            No tools loaded yet — set the server above and click <em>Load tools</em>, then pick the
            tool this node calls.
          </p>
        </div>

        <!-- Arguments for the selected tool: a form generated from its inputSchema
             (inspector-style), with a raw-JSON escape hatch. Schema-less tools
             only get the JSON editor. -->
        <div v-if="mcpTool" class="space-y-1.5 border-t pt-3">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Arguments</label>
            <div v-if="mcpToolSchema" class="flex overflow-hidden rounded border" style="border-color: var(--line-strong)">
              <button
                v-for="v in (['form', 'json'] as const)"
                :key="v"
                class="px-2 py-0.5 text-[11px] font-medium transition-colors"
                :style="mcpArgsView === v
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { color: 'var(--fg-muted)' }"
                @click="mcpArgsView = v"
              >
                {{ v === 'form' ? 'Form' : 'JSON' }}
              </button>
            </div>
          </div>

          <!-- Generated form (tool has a usable inputSchema) -->
          <template v-if="mcpToolSchema && mcpArgsView === 'form'">
            <JsonSchemaForm
              :schema="mcpToolSchema"
              :model-value="mcpArgs"
              @update:model-value="onMcpArgsFormUpdate"
            />
            <p class="text-[11px] leading-relaxed text-fg-subtle">
              Built from the tool's input schema. Text values may embed
              <code v-pre>{{$.path}}</code> context variables.
            </p>
          </template>

          <!-- Raw JSON (explicit toggle, or no schema to build a form from) -->
          <template v-else>
            <CodeEditor
              :model-value="mcpArgsText"
              language="json"
              inline
              wrap
              placeholder='{ "query": "{{input}}" }'
              @update:model-value="onMcpArgsInput"
            />
            <p v-if="mcpArgsError" class="text-[12px] text-danger">Invalid JSON: {{ mcpArgsError }}</p>
            <p class="text-[11px] leading-relaxed text-fg-subtle">
              JSON arguments passed to <code>call_tool</code>, matching the tool's input schema. Values
              may embed <code v-pre>{{$.path}}</code> context variables.
            </p>
          </template>
        </div>
      </template>
    </template>

    <!-- ================= Goto ================= -->
    <template v-else-if="isGoto">
      <!-- Target flow -->
      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Target workflow</label>
        <select v-model="gotoFlowId" class="input" :disabled="flowsLoading">
          <option value="">{{ flowsLoading ? 'Loading…' : '— select a workflow —' }}</option>
          <option v-for="f in targetFlows" :key="f.id" :value="f.id">{{ f.title || f.id }}</option>
        </select>
        <p v-if="!flowsLoading && targetFlows.length === 0" class="text-[11px] text-fg-subtle">
          No other workflows to jump to.
        </p>
      </div>

      <!-- From / End nodes of the target flow -->
      <template v-if="gotoFlowId">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">From node</label>
          <select v-model="gotoFrom" class="input" :disabled="nodesLoading">
            <option value="">{{ nodesLoading ? 'Loading…' : '— entry node —' }}</option>
            <option v-for="n in targetNodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">End node</label>
          <select v-model="gotoEnd" class="input" :disabled="nodesLoading">
            <option value="">{{ nodesLoading ? 'Loading…' : '— return node —' }}</option>
            <option v-for="n in targetNodes" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
          <p class="text-[11px] leading-relaxed text-fg-subtle">
            Control jumps into the target flow at <em>From</em> and returns after <em>End</em>.
          </p>
        </div>
      </template>
    </template>

    <!-- ================= Continue After (until) ================= -->
    <template v-else-if="isUntil">
      <!-- Mode: a delay unit, or an absolute date/time -->
      <div class="space-y-1.5">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Resume</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="opt in UNTIL_UNITS"
            :key="opt.id"
            class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
            :style="untilMode === opt.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : { color: 'var(--fg-muted)' }"
            @click="untilMode = opt.id"
          >
            {{ opt.label }}
          </button>
          <button
            class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
            :style="untilMode === 'at'
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : { color: 'var(--fg-muted)' }"
            @click="untilMode = 'at'"
          >
            <Icon name="node-until" :size="14" />
            At a date
          </button>
        </div>
      </div>

      <!-- Delay amount (unit modes) -->
      <div v-if="untilMode !== 'at'" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Amount</label>
        <div class="flex items-center gap-2">
          <input
            v-model.number="untilValue"
            type="number"
            min="0"
            class="input w-28 font-mono text-xs"
            placeholder="0"
          />
          <span class="text-[13px] text-fg-muted">{{ untilMode }} after this node runs</span>
        </div>
        <p class="text-[11px] leading-relaxed text-fg-subtle">
          The flow parks here and a scheduled run resumes its outbound nodes
          {{ untilValue }} {{ untilMode }} after the runtime reaches this node.
        </p>
      </div>

      <!-- Absolute date/time (at mode) -->
      <div v-else class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Date &amp; time</label>
        <input v-model="untilAt" type="datetime-local" class="input font-mono text-xs" />
        <p class="text-[11px] leading-relaxed text-fg-subtle">
          The flow parks here and a scheduled run resumes its outbound nodes at this absolute time.
        </p>
      </div>
    </template>
  </div>
</template>
