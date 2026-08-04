<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import PromptImporter from '@/components/flow/PromptImporter.vue'
import type { BaseNodeData } from '@/data/nodeCatalog'
import {
  HITL_CHANNELS,
  HITL_MODES,
  detectPromptRefs,
  hitlQuestions,
  hitlRefs,
  migrateHitlData,
  suggestRefName,
  type HitlChannel,
  type HitlMode,
  type HitlQuestion,
  type HitlRef,
} from '@/lib/hitl'

/**
 * Settings editor for the Human-in-the-Loop node.
 *
 * Everything here is authored at design time and shipped whole to the backend
 * `hitl` service as the node's compile-time operation payload (`op`) — because
 * an Extrinsic svc handler cannot resolve context variables at run time. So the
 * prompt travels as an unresolved TEMPLATE, together with the context paths it
 * needs; the handler records them on the Human Task alongside the run identity
 * (pid / flowId / nodeId / contextId) and the node's outbound edges, and the
 * prompt is only resolved later — when a person opens the task and the
 * conversation actually starts.
 *
 * The four things a designer decides here:
 *
 *   mode      park → the handler answers with a `stop` command and the run
 *             finishes at this node (it resumes from the captured next nodes
 *             once the session is closed); continue → the handler only records
 *             the task and answers plainly, so the flow carries straight on.
 *   prompt    the opening turn of the conversation, embedding `{{$.path}}`
 *             variables that point at whatever the flow built up to here (an
 *             MCP/LLM message stack, a question that came out of it, …).
 *   refs      those context pointers, named — so the session can show the
 *             captured subject even where the prompt text doesn't inline it.
 *   channel   where the conversation happens. Phase one is the in-app Direct
 *             chat (Operate → Human Tasks); the messenger channels need a
 *             provider integration and are not selectable yet.
 *
 * The values live on the node's own `data` (`mode` / `prompt` / `refs` /
 * `questions` / `channel`) — the shape the node catalog's `hitl` spec declares
 * and `buildHitlNode` compiles.
 */
const props = defineProps<{ node: GraphNode }>()

function data(): BaseNodeData {
  return props.node.data as BaseNodeData
}

// A node authored before this editor carried its fields as `operationData`
// key/value rows, which the compiler never read. Fold them into questions on
// first open so nothing a designer typed is lost.
onMounted(() => migrateHitlData(data()))

// ---- Mode -------------------------------------------------------------------

const mode = computed<HitlMode>({
  get: () => (data().mode === 'continue' ? 'continue' : 'park'),
  set: (v) => {
    data().mode = v
  },
})

// ---- Prompt -----------------------------------------------------------------

const prompt = computed<string>({
  get: () => String(data().prompt ?? ''),
  set: (v) => {
    data().prompt = v
  },
})

// The literal shown in help text; kept in script so its braces don't collide
// with Vue's own `{{ }}` interpolation in the template.
const PATH_HINT = '{{$.path}}'

/** `{{$.path}}` variables written in the prompt that are not declared as refs
 *  yet — offered as one-click chips so the recorded pointers stay in step with
 *  the text that uses them. */
const undeclared = computed(() => {
  const declared = new Set(refs().map((r) => r.path))
  return detectPromptRefs(prompt.value).filter((p) => !declared.has(p))
})

// ---- Context references -----------------------------------------------------

function refs(): HitlRef[] {
  return hitlRefs(data())
}

function addRef(path = '') {
  refs().push({ id: `ref-${Date.now()}`, name: suggestRefName(path, refs()), path })
}

function removeRef(i: number) {
  refs().splice(i, 1)
}

// ---- Questions --------------------------------------------------------------

function questions(): HitlQuestion[] {
  return hitlQuestions(data())
}

function addQuestion() {
  questions().push({ id: `q-${Date.now()}`, text: '' })
}

function removeQuestion(i: number) {
  questions().splice(i, 1)
}

// ---- Channel ----------------------------------------------------------------

const channel = computed<HitlChannel>({
  get: () => {
    const v = String(data().channel ?? 'direct')
    return HITL_CHANNELS.some((c) => c.id === v) ? (v as HitlChannel) : 'direct'
  },
  set: (v) => {
    data().channel = v
  },
})
</script>

<template>
  <div class="space-y-4">
    <!-- ---- Mode: park or continue ---- -->
    <div class="space-y-1.5">
      <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        When the flow reaches this node
      </label>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="opt in HITL_MODES"
          :key="opt.id"
          type="button"
          class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
          :style="mode === opt.id
            ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
            : { color: 'var(--fg-muted)' }"
          :title="opt.hint"
          @click="mode = opt.id"
        >
          <Icon :name="opt.icon" :size="14" />
          {{ opt.label }}
        </button>
      </div>
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        {{ HITL_MODES.find((m) => m.id === mode)?.hint }}
      </p>
    </div>

    <!-- ---- Conversation prompt ---- -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Conversation prompt</label>
        <PromptImporter v-model="prompt" label="Human prompt" />
      </div>
      <textarea
        v-model="prompt"
        rows="5"
        spellcheck="false"
        class="input resize-none font-mono text-xs leading-relaxed"
        placeholder="Review the thread below and answer the open question.&#10;&#10;{{$.messages}}"
      />
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        The opening turn of the conversation with the person. Embed
        <span class="font-mono">{{ PATH_HINT }}</span> variables to pull in what the flow built up to here — a message
        stack from an MCP / LLM node, the question it ended on. The text is stored unresolved and filled in when the
        session opens, against the data this node captured, so keep
        <span class="font-mono">scope</span> wide enough (<span class="font-mono">$</span>) to cover every path used.
      </p>
    </div>

    <!-- ---- Context references ---- -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Context references</label>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addRef()">
          <Icon name="plus" :size="13" /> Add
        </button>
      </div>

      <!-- Paths used in the prompt but not declared: one click to record them. -->
      <div v-if="undeclared.length" class="flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] text-fg-subtle">In the prompt:</span>
        <button
          v-for="path in undeclared"
          :key="path"
          class="flex items-center gap-1 rounded-full border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted hover:border-accent hover:text-accent"
          :title="`Record ${path} with the session`"
          @click="addRef(path)"
        >
          <Icon name="plus" :size="11" /> {{ path }}
        </button>
      </div>

      <div v-for="(ref, i) in refs()" :key="ref.id ?? i" class="flex items-center gap-1.5">
        <input v-model="ref.name" class="input w-28 shrink-0 text-xs" placeholder="name" />
        <input v-model="ref.path" class="input flex-1 font-mono text-xs" placeholder="$.messages" />
        <button
          class="shrink-0 rounded-lg p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger"
          title="Remove reference"
          @click="removeRef(i)"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>

      <p class="text-[11px] leading-relaxed text-fg-subtle">
        Named pointers into the run's context, resolved with the prompt when the session opens. Use them for the subject
        matter a person needs but the prompt text shouldn't inline verbatim — a long thread, a document, a tool result.
      </p>
    </div>

    <!-- ---- Questions ---- -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Questions</label>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addQuestion">
          <Icon name="plus" :size="13" /> Add
        </button>
      </div>
      <div v-for="(q, i) in questions()" :key="q.id ?? i" class="flex items-start gap-1.5">
        <span
          class="mt-1.5 w-4 shrink-0 text-right text-[11px] font-semibold text-fg-subtle"
        >{{ i + 1 }}</span>
        <textarea
          v-model="q.text"
          rows="1"
          class="input flex-1 resize-none text-xs"
          placeholder="What should the person answer?"
        />
        <button
          class="mt-0.5 shrink-0 rounded-lg p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger"
          title="Remove question"
          @click="removeQuestion(i)"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>
      <p v-if="questions().length === 0" class="text-[11px] text-fg-subtle">
        No questions yet — the session opens on the prompt alone and the person closes it when done.
      </p>
      <p v-else class="text-[11px] leading-relaxed text-fg-subtle">
        Each becomes an answerable field on the Human Task. The task turns
        <span class="font-medium text-fg-muted">answered</span> once every one is filled in.
      </p>
    </div>

    <!-- ---- Session channel ---- -->
    <div class="space-y-1.5">
      <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Session channel</label>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="opt in HITL_CHANNELS"
          :key="opt.id"
          type="button"
          class="flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors"
          :class="opt.available ? '' : 'cursor-not-allowed opacity-50'"
          :style="channel === opt.id
            ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
            : { color: 'var(--fg-muted)' }"
          :disabled="!opt.available"
          :title="opt.available ? opt.hint : `${opt.hint} — not available yet`"
          @click="channel = opt.id"
        >
          <Icon :name="opt.icon" :size="15" />
          {{ opt.label }}
        </button>
      </div>
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        {{ HITL_CHANNELS.find((c) => c.id === channel)?.hint }}
        <template v-if="channel === 'direct'">
          Open it from Operate → Human Tasks.
        </template>
      </p>
    </div>
  </div>
</template>
