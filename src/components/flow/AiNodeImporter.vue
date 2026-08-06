<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import PatchReview from './PatchReview.vue'
import {
  buildDesignerPrompt,
  parseAiGraph,
  planPatch,
  type PlannedPatch,
} from '@/lib/aiGraph'
import { fetchPluginActions, type PluginActionEntry } from '@/lib/nodeExtRefs'
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

// The imported-plugin actions registered in this install, listed in the prompt
// so the model can reach for one (a Jira action, say) instead of inventing an
// integration that isn't here. Fetched (cached) when the dialog opens, and left
// empty when there is no backend or nothing imported — the prompt then simply
// has no Plugins section and the model stays on the builtins.
const plugins = ref<PluginActionEntry[]>([])

function openDialog() {
  snapshot.value = props.resolveGraph()
  copied.value = false
  showPrompt.value = false
  open.value = true
  void fetchPluginActions().then((list) => (plugins.value = list))
}

const prompt = computed(() => buildDesignerPrompt(goal.value, snapshot.value, plugins.value))

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

const canApply = computed(() => (plan.value?.nodes.length ?? 0) > 0)

function apply() {
  const planned = plan.value
  if (!planned || !canApply.value) return
  emit('apply', planned)
  open.value = false
  response.value = ''
  goal.value = ''
}
</script>

<template>
  <ToolButton
    icon="sparkles"
    label="AI build"
    title="Build with AI — design nodes with an assistant and add them to this canvas"
    @click="openDialog"
  />

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
        <PatchReview :plan="plan" :existing="snapshot" />
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
