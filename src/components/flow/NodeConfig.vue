<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import { flowsApi } from '@/api/flows'
import type { FlowRecord } from '@/types/api'

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

// ---- LLM system role prompt (stored on data.body.prompt) -------------------
// The system role prompt doubles as the node's display title, so writing it
// also mirrors the text into `data.title` (falling back to 'LLM' when empty).
const prompt = computed<string>({
  get: () => {
    const body = (data().body as Record<string, unknown>) ?? {}
    return typeof body.prompt === 'string' ? body.prompt : ''
  },
  set: (v) => {
    const body = (data().body as Record<string, unknown>) ?? {}
    body.prompt = v
    data().body = body
    data().title = v.trim() || 'LLM'
  },
})

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
        <textarea
          v-model="code"
          rows="6"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
          :placeholder="lang === 'opa' ? 'package flomorphic\n\nresult := true' : '// last expression is the result\nreturn { ok: true }'"
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
      <!-- System role prompt (also drives the node's display title) -->
      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">System role prompt</label>
        <textarea
          v-model="prompt"
          rows="5"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
          placeholder="You are a helpful assistant. {{input}}"
        />
        <p class="text-[11px] leading-relaxed text-fg-subtle">
          Sets the model's system role and doubles as this node's title. The model's global config
          (provider, key, model) comes from the Settings profile above.
        </p>
      </div>

      <!-- Functions → output ports -->
      <div class="space-y-1.5 border-t pt-3">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            Functions
            <span class="ml-1 font-normal normal-case text-fg-subtle">— one outbound port each</span>
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
