<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import JsonPathQuery from '@/components/ui/JsonPathQuery.vue'
import { queryJsonPath, JsonPathError } from '@/lib/jsonpath'
import { formatProcessTime, processStatusClass } from '@/lib/process'
import { useLastRunContextStore } from '@/stores/lastRunContext'
import { specForType } from '@/data/nodeCatalog'
import type { NodeScopeProbe } from '@/lib/nodeScopeProbe'

/**
 * What one node's `scope` actually covers, resolved against the context the flow
 * last ran with — the canvas-side shortcut for a question that used to mean
 * leaving the editor for the context page and retyping the expression there.
 *
 * Two readings of the same document, in one place: the node's *declared* scope,
 * summarized as the locations it selects (and therefore how many passes the node
 * makes — a scope selecting many values runs the node once per value), and the
 * probe below it, seeded with that scope and free to be edited so a designer can
 * explore outwards from it. Both go through the same evaluator the context page
 * uses (`lib/jsonpath`), so what reads here is what a node's `{{$.path}}`
 * template resolves to.
 *
 * Strictly a lens: it never writes the context, and never touches node data. The
 * document is the context *as it stands now* — the last run's writes included —
 * not a snapshot of what the node saw mid-run; the log drawer is where a single
 * pass is replayed.
 */
const props = defineProps<{
  open: boolean
  /** The node being inspected; null while the dialog is closed. */
  probe: NodeScopeProbe | null
  /** The flow the canvas has open — whose last run names the context. */
  flowId?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const router = useRouter()
const store = useLastRunContextStore()

const entry = computed(() => store.entry(props.flowId))
const record = computed(() => entry.value?.context ?? null)
const run = computed(() => entry.value?.run ?? null)

/** The document to resolve against, wrapped the way the context page wraps a
 *  non-object document so a JSONPath always has a root object to walk. */
const document = computed<unknown>(() => {
  const doc = entry.value?.document
  if (doc === null || doc === undefined) return null
  if (typeof doc === 'object' && !Array.isArray(doc)) return doc
  return { value: doc }
})

/** An empty scope means the node takes the whole document. */
const scope = computed(() => props.probe?.scope?.trim() || '$')
const spec = computed(() => (props.probe ? specForType(props.probe.type) : undefined))

const refreshing = ref(false)

// Resolve on open, and whenever the dialog is pointed at another flow. Cached in
// the store, so reopening a second node is instant.
watch(
  () => [props.open, props.flowId] as const,
  ([open, flowId]) => {
    if (open && flowId) void store.ensure(flowId)
  },
  { immediate: true },
)

async function refresh() {
  if (!props.flowId || refreshing.value) return
  refreshing.value = true
  try {
    await store.ensure(props.flowId, true)
  } finally {
    refreshing.value = false
  }
}

/**
 * The declared scope, evaluated: how many locations it selects and what the
 * first ones are. This is the fan-out the engine derives — one pass per selected
 * location — so it reads as the headline, above the free-form probe.
 */
const resolved = computed<{ count: number; paths: string[]; error: string | null }>(() => {
  if (document.value === null) return { count: 0, paths: [], error: null }
  try {
    const matches = queryJsonPath(document.value, scope.value)
    return { count: matches.length, paths: matches.map((m) => m.path), error: null }
  } catch (e) {
    const msg = e instanceof JsonPathError ? e.message : (e as Error).message
    return { count: 0, paths: [], error: msg }
  }
})

/** How the node's scope behaves on this document, in one line. */
const fanout = computed(() => {
  const n = resolved.value.count
  if (n === 0) return 'Selects nothing here — the node would find no slice to run against.'
  if (n === 1) return 'Selects one location — the node runs once against it.'
  return `Selects ${n} locations — the node runs ${n} times, each pass seeing only its own.`
})

/** Where the node's own result lands, when it binds a key. */
const resultPath = computed(() => {
  const key = props.probe?.key?.trim()
  if (!key) return ''
  return scope.value === '$' ? `$.${key}` : `${scope.value}.${key}`
})

/**
 * The jumps the probe offers: the node's declared scope, and — when the node
 * binds a key — that scope plus the key, i.e. where its own result lands. Two
 * readings a designer flips between constantly ("what do I read" / "what did I
 * write"), and retyping the second one by hand was the whole friction.
 */
const probeShortcuts = computed(() => {
  const jumps = [{ label: scope.value, query: scope.value, hint: `Back to this node’s scope — ${scope.value}` }]
  if (resultPath.value && resultPath.value !== scope.value) {
    jumps.push({
      label: `+ .${props.probe?.key?.trim()}`,
      query: resultPath.value,
      hint: `Probe where this node writes — ${resultPath.value}`,
    })
  }
  return jumps
})

/** The context page for this document, opened in a tab of its own — the editor
 *  may be holding unsaved graph edits that a navigation would discard. */
const contextHref = computed(() =>
  record.value ? router.resolve({ name: 'context-detail', params: { id: record.value.id } }).href : '',
)
</script>

<template>
  <Modal
    :open="open"
    size="xl"
    :title="probe ? `Scope · ${probe.title}` : 'Scope'"
    subtitle="What this node’s scope covers in the context this flow last ran with."
    @close="emit('close')"
  >
    <div v-if="probe" class="space-y-3">
      <!-- The node, its scope, and where its result lands. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-surface-2/50 px-3 py-2">
        <span class="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
          <Icon name="scope" :size="14" class="text-fg-subtle" />
          <code class="font-mono text-[12.5px] text-accent">{{ scope }}</code>
        </span>
        <span v-if="spec" class="chip text-[10px] uppercase tracking-wide">{{ spec.label }}</span>
        <span v-if="resultPath" class="flex items-center gap-1 text-[11px] text-fg-subtle">
          <Icon name="key" :size="12" />
          writes <code class="font-mono">{{ resultPath }}</code>
        </span>
      </div>

      <!-- Which document this resolves against, and how fresh it is. -->
      <div
        v-if="record"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-[12px]"
      >
        <span class="flex items-center gap-1.5 font-medium text-fg">
          <Icon name="context" :size="14" class="text-accent" />
          {{ record.title }}
        </span>
        <span
          v-if="run"
          class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize"
          :class="processStatusClass(run.status)"
        >{{ run.status }}</span>
        <span v-if="run" class="text-[11px] text-fg-subtle">
          last run <span class="font-mono font-semibold">#{{ run.indexId }}</span>
          <template v-if="formatProcessTime(run.startedAt)"> · {{ formatProcessTime(run.startedAt) }}</template>
        </span>
        <div class="ml-auto flex items-center gap-3">
          <button
            class="flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg"
            :disabled="refreshing"
            title="Re-read the context — a run may have written to it since"
            @click="refresh"
          >
            <Icon name="refresh" :size="12" /> {{ refreshing ? 'Reading…' : 'Refresh' }}
          </button>
          <a
            :href="contextHref"
            target="_blank"
            rel="noopener"
            class="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            title="Open the full context in a new tab"
          >
            <Icon name="external-link" :size="12" /> Context page
          </a>
        </div>
      </div>

      <!-- Nothing to resolve against: loading, never run, unreadable, or failed. -->
      <p v-if="entry?.loading" class="rounded-lg bg-surface-2 px-3 py-6 text-center text-[13px] text-fg-muted">
        Reading the last run’s context…
      </p>
      <p v-else-if="entry?.error" class="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
        {{ entry.error }}
      </p>
      <p
        v-else-if="!run"
        class="rounded-lg border border-dashed px-3 py-6 text-center text-[13px] text-fg-muted"
      >
        This flow hasn’t run yet — there is no context to resolve
        <code class="font-mono">{{ scope }}</code> against. Run it once, then come back.
      </p>
      <p
        v-else-if="document === null"
        class="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400"
      >
        The last run’s context isn’t valid JSON — open the context page to fix it.
      </p>

      <template v-else>
        <!-- The declared scope, evaluated: the fan-out and the locations it hits. -->
        <div class="space-y-1.5 rounded-lg border bg-surface-2/40 px-3 py-2.5">
          <p v-if="resolved.error" class="text-[12px] text-danger">
            This scope isn’t a valid JSONPath: {{ resolved.error }}
          </p>
          <template v-else>
            <p class="flex items-center gap-1.5 text-[12px] text-fg">
              <Icon
                :name="resolved.count === 0 ? 'alert-triangle' : 'check'"
                :size="13"
                :class="resolved.count === 0 ? 'text-warning' : 'text-emerald-500'"
              />
              {{ fanout }}
            </p>
            <div v-if="resolved.paths.length" class="flex flex-wrap gap-1.5">
              <code
                v-for="p in resolved.paths.slice(0, 12)"
                :key="p"
                class="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
              >{{ p }}</code>
              <span v-if="resolved.paths.length > 12" class="text-[11px] text-fg-subtle">
                +{{ resolved.paths.length - 12 }} more
              </span>
            </div>
          </template>
        </div>

        <!-- The probe, seeded with the node's scope: explore outwards from it. -->
        <JsonPathQuery
          :key="probe.nodeId"
          :root="document"
          :initial-query="scope"
          :shortcuts="probeShortcuts"
          resizable
          placeholder="JSONPath — edit to explore around this node’s scope"
        />
      </template>
    </div>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">Close</Button>
    </template>
  </Modal>
</template>
