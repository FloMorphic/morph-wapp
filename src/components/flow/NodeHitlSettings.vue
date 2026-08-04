<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import PromptImporter from '@/components/flow/PromptImporter.vue'
import type { BaseNodeData } from '@/data/nodeCatalog'
import {
  DEFAULT_HITL_PROMPT,
  HITL_CHANNELS,
  HITL_MODES,
  migrateHitlData,
  type HitlChannel,
  type HitlMode,
} from '@/lib/hitl'

/**
 * Settings editor for the Human-in-the-Loop node.
 *
 * Everything here is authored at design time and shipped whole to the backend
 * `hitl` service as the node's compile-time operation payload (`op`) — which the
 * runtime resolves before the svc handler ever sees it: any `{{$.path}}` in the
 * payload is filled in from the run's context first. So the prompt written here
 * arrives at the handler as real text and is recorded ready to show a person.
 *
 * The three things a designer decides:
 *
 *   mode      park → the handler answers with a `stop` command and the run
 *             finishes at this node; the flow resumes from every captured next
 *             node once the session is closed. continue → the handler only
 *             records the task and answers plainly, so the flow carries on.
 *   prompt    what the session has to establish with the person, embedding
 *             `{{$.path}}` variables that pull in whatever the flow built up to
 *             here (an MCP/LLM message stack, the point it got stuck on). There
 *             is no question list beside it: a node is reached precisely because
 *             the flow could not settle something, so the questions are worked
 *             out in the session, not written on the canvas.
 *   channel   where the conversation happens. Phase one is the in-app Direct
 *             chat (Operate → Human Tasks); the messenger channels need a
 *             provider integration and are not selectable yet.
 *
 * The values live on the node's own `data` (`mode` / `prompt` / `channel`) — the
 * shape the node catalog's `hitl` spec declares and `buildHitlNode` compiles.
 */
const props = defineProps<{ node: GraphNode }>()

function data(): BaseNodeData {
  return props.node.data as BaseNodeData
}

// Clear the fields earlier versions of this editor wrote (see migrateHitlData).
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
        :placeholder="DEFAULT_HITL_PROMPT"
      />
      <p class="text-[11px] leading-relaxed text-fg-subtle">
        What the session has to establish with the person. Embed
        <span class="font-mono">{{ PATH_HINT }}</span> variables to pull in what the flow built up to here — a message
        stack from an MCP / LLM node, the point it got stuck on. They are resolved against the run's context before the
        task is recorded, so the session opens on the subject matter, not the paths. The questions themselves come out
        of the conversation: a flow reaches a person because it could not settle something, so what to ask is not
        knowable here.
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
