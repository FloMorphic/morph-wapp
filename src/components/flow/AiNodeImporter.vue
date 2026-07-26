<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import { specForType } from '@/data/nodeCatalog'
import {
  buildDesignerPrompt,
  parseAiGraph,
  planPatch,
  type PlannedPatch,
} from '@/lib/aiGraph'
import type { VueFlowGraph } from '@/types/api'

/**
 * "Build with AI" — the bridge that lets an assistant put nodes on the canvas.
 *
 * Step one of the AI designer, and deliberately the *unassisted* one: it hands
 * you the exact prompt for the current catalog and the graph on screen, you run
 * it in whichever chat you like, and it validates and previews what comes back
 * before a single node is added. No provider, no key, no backend — so the
 * contract (lib/aiGraph) can be proven against real model output before a chat
 * panel or an MCP server over the designer is built on top of it. Both of those
 * reuse this component's two calls: `buildDesignerPrompt` and `planPatch`.
 *
 * The preview is the point. A patch is applied only after its problems are on
 * screen: an unknown node kind or an edge leaving a port that doesn't exist is
 * dropped (and said so), and the things a model cannot know — which settings
 * profile, which store, which server URL — are listed as warnings to fill in
 * afterwards. Design-time values only: nothing here reads a run or a context.
 */
const props = defineProps<{
  /** The graph currently on the canvas, read when the dialog needs it. */
  resolveGraph: () => VueFlowGraph
}>()
const emit = defineEmits<{ (e: 'apply', patch: PlannedPatch): void }>()

const open = ref(false)
const goal = ref('')
const response = ref('')
const copied = ref(false)
const showPrompt = ref(false)

// The graph is snapshotted when the dialog opens: the prompt lists the node ids
// the model may wire into, and the plan is laid out clear of them, so both have
// to describe the same canvas for the whole session.
const snapshot = ref<VueFlowGraph>({ nodes: [], edges: [] })

function openDialog() {
  snapshot.value = props.resolveGraph()
  copied.value = false
  showPrompt.value = false
  open.value = true
}

const prompt = computed(() => buildDesignerPrompt(goal.value, snapshot.value))

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(prompt.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked (insecure origin / permission) — the prompt panel is the
    // fallback, so open it and let the text be selected by hand.
    showPrompt.value = true
  }
}

// ---- Review ----------------------------------------------------------------
// Parsed and planned on every keystroke. Planning is pure and cheap at patch
// size, so the preview is simply derived state — there is no "validate" button.
const parsed = computed(() => parseAiGraph(response.value))
const plan = computed<PlannedPatch | null>(() =>
  parsed.value.patch ? planPatch(parsed.value.patch, snapshot.value) : null,
)

const errors = computed(() => plan.value?.problems.filter((p) => p.level === 'error') ?? [])
const warnings = computed(() => plan.value?.problems.filter((p) => p.level === 'warn') ?? [])
const canApply = computed(() => (plan.value?.nodes.length ?? 0) > 0)

/** Node ids → their patch ref, so the edge list reads in the model's names. */
const refById = computed(() => new Map((plan.value?.nodes ?? []).map((n) => [n.id, n.ref])))
function endpointLabel(id: string): string {
  const ref = refById.value.get(id)
  if (ref) return ref
  const existing = snapshot.value.nodes.find((n) => n.id === id)
  const title = String((existing?.data as Record<string, unknown>)?.title ?? '').trim()
  return title || id
}

function apply() {
  const planned = plan.value
  if (!planned || !canApply.value) return
  emit('apply', planned)
  open.value = false
  response.value = ''
  goal.value = ''
}

function specColor(type: string): string {
  return specForType(type)?.color ?? 'var(--fg-muted)'
}
</script>

<template>
  <Button icon="sparkles" title="Design nodes with an AI assistant and add them to this canvas" @click="openDialog">
    <span class="hidden sm:inline">Build with AI</span>
  </Button>

  <Modal
    :open="open"
    size="lg"
    title="Build with AI"
    subtitle="Describe the workflow, run the prompt in your assistant, then paste what it returns. Nothing is added until you review it."
    @close="open = false"
  >
    <div class="space-y-5">
      <!-- 1 · the goal → the prompt ------------------------------------- -->
      <section class="space-y-2">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="text-[13px] font-semibold text-fg">
            <span class="mr-1.5 text-fg-subtle">1.</span>What should this workflow do?
          </h3>
          <span class="text-[11px] text-fg-subtle">
            {{ snapshot.nodes.length }} node{{ snapshot.nodes.length === 1 ? '' : 's' }} already on canvas
          </span>
        </div>
        <textarea
          v-model="goal"
          class="input min-h-[76px] resize-y text-sm leading-relaxed"
          placeholder="e.g. Read the incoming support ticket, have an LLM classify it as billing / technical / spam, and route each one — spam ends the flow, the others ask a human to confirm before replying."
        />
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="primary" :icon="copied ? 'check' : 'copy'" @click="copyPrompt">
            {{ copied ? 'Prompt copied' : 'Copy designer prompt' }}
          </Button>
          <Button :icon="showPrompt ? 'chevron-down' : 'chevron-right'" @click="showPrompt = !showPrompt">
            {{ showPrompt ? 'Hide prompt' : 'View prompt' }}
          </Button>
          <p class="text-[11.5px] text-fg-subtle">
            Carries the node catalog, the wiring rules and the ids on this canvas — paste it into any chat.
          </p>
        </div>
        <pre
          v-if="showPrompt"
          class="max-h-56 overflow-auto rounded-xl border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted"
          >{{ prompt }}</pre
        >
      </section>

      <!-- 2 · paste the answer ----------------------------------------- -->
      <section class="space-y-2">
        <h3 class="text-[13px] font-semibold text-fg">
          <span class="mr-1.5 text-fg-subtle">2.</span>Paste the assistant's answer
        </h3>
        <textarea
          v-model="response"
          spellcheck="false"
          class="input min-h-[120px] resize-y font-mono text-[12px] leading-relaxed"
          placeholder='{ "nodes": [ … ], "edges": [ … ] }'
        />
        <p v-if="parsed.error" class="flex items-start gap-1.5 text-[12px] text-danger">
          <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
          {{ parsed.error }}
        </p>
      </section>

      <!-- 3 · review ---------------------------------------------------- -->
      <section v-if="plan" class="space-y-3">
        <h3 class="text-[13px] font-semibold text-fg">
          <span class="mr-1.5 text-fg-subtle">3.</span>Review
        </h3>

        <p v-if="!canApply" class="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-fg-muted">
          Nothing to add — the patch declared no usable nodes.
        </p>

        <div v-else class="space-y-1.5">
          <div
            v-for="n in plan.nodes"
            :key="n.id"
            class="flex items-start gap-2.5 rounded-xl border px-3 py-2"
          >
            <span
              class="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              :style="{ background: `color-mix(in srgb, ${specColor(n.type)} 16%, transparent)`, color: specColor(n.type) }"
            >
              <Icon :name="n.spec.icon" :size="13" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="text-[13px] font-semibold text-fg">{{ n.data.title || n.spec.label }}</span>
                <span class="chip">{{ n.spec.label }}</span>
                <span v-if="n.data.key" class="font-mono text-[11px] text-fg-subtle">→ {{ n.data.key }}</span>
              </div>
              <p v-if="n.note" class="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{{ n.note }}</p>
            </div>
          </div>

          <div v-if="plan.edges.length" class="flex flex-wrap gap-1.5 pt-1">
            <span v-for="e in plan.edges" :key="e.id" class="chip font-mono text-[11px]">
              {{ endpointLabel(e.source) }}<template v-if="e.portLabel"> · {{ e.portLabel }}</template> →
              {{ endpointLabel(e.target) }}
            </span>
          </div>
        </div>

        <!-- Dropped items: said out loud, never applied silently. -->
        <div v-if="errors.length" class="rounded-xl border border-dashed p-3" style="border-color: var(--danger)">
          <p class="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
            <Icon name="alert-triangle" :size="14" />
            {{ errors.length }} item{{ errors.length === 1 ? '' : 's' }} dropped
          </p>
          <ul class="mt-1.5 space-y-1">
            <li v-for="(p, i) in errors" :key="i" class="text-[12px] leading-relaxed text-fg-muted">
              <span v-if="p.at" class="font-mono text-fg-subtle">{{ p.at }}</span>
              {{ p.message }}
            </li>
          </ul>
        </div>

        <div v-if="warnings.length" class="rounded-xl border border-dashed p-3">
          <p class="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <Icon name="info" :size="14" class="text-fg-subtle" />
            Finish by hand after adding
          </p>
          <ul class="mt-1.5 space-y-1">
            <li v-for="(p, i) in warnings" :key="i" class="text-[12px] leading-relaxed text-fg-muted">
              <span v-if="p.at" class="font-mono text-fg-subtle">{{ p.at }}</span>
              {{ p.message }}
            </li>
          </ul>
        </div>

        <div v-if="plan.notes.length" class="rounded-xl bg-surface-2 p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Assistant notes</p>
          <ul class="mt-1.5 space-y-1">
            <li v-for="(note, i) in plan.notes" :key="i" class="text-[12px] leading-relaxed text-fg-muted">{{ note }}</li>
          </ul>
        </div>
      </section>
    </div>

    <template #footer>
      <Button @click="open = false">Cancel</Button>
      <Button variant="primary" icon="plus" :disabled="!canApply" @click="apply">
        {{ canApply ? `Add ${plan?.nodes.length} node${plan?.nodes.length === 1 ? '' : 's'} to canvas` : 'Add to canvas' }}
      </Button>
    </template>
  </Modal>
</template>
