<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { FlowValidation, FlowValidationIssue } from '@/types/api'

/**
 * What the backend's graph check found, shown over the canvas after a save (or
 * after an explicit Check) — and shown as **advice**, which is the whole design
 * of this banner.
 *
 * The backend refuses nothing over these findings: the flow in the response is
 * already saved, and a run, a trigger fire or a resumed human task is never
 * blocked by them. It cannot be otherwise — the checks reason about one
 * traversal, the one starting at the flow's start node, while a resumed run
 * enters wherever its parked node left off, on several nodes at once. So this is
 * a reading of the graph an author can act on, not a verdict on their save:
 * dismissible, never modal, and every row jumps to the node (or the edge) whose
 * change would settle it.
 *
 * `errors` are mistakes that will cost a run — a join waiting on a step that
 * comes after it will sit there forever; `warnings` are loose ends, like a node
 * nothing reaches. Both are listed; neither stops anything.
 */
const props = defineProps<{
  validation?: FlowValidation | null
  /** Where the findings came from, for the one line of context above them. */
  source?: 'save' | 'check'
}>()

const emit = defineEmits<{
  /** Reveal the canvas objects a finding names. */
  (e: 'reveal', target: { nodeId?: string; edgeId?: string }): void
  (e: 'dismiss'): void
}>()

const dismissed = ref(false)
const expanded = ref(true)

// A fresh result is a fresh banner: the author just asked (or just saved), so a
// dismissal of the previous one must not swallow it.
watch(
  () => props.validation,
  () => {
    dismissed.value = false
    expanded.value = true
  },
)

const issues = computed<FlowValidationIssue[]>(() => props.validation?.issues ?? [])
const errorCount = computed(() => props.validation?.errorCount ?? 0)
const warningCount = computed(() => props.validation?.warningCount ?? 0)
const show = computed(() => !dismissed.value && issues.value.length > 0)

/** Errors tint the banner red, warnings amber — the same pair the rest of the
 *  app uses for "this will cost you" vs "loose end". */
const tone = computed(() => (errorCount.value > 0 ? 'error' : 'warning'))

const headline = computed(() => {
  const parts: string[] = []
  if (errorCount.value) parts.push(`${errorCount.value} problem${errorCount.value === 1 ? '' : 's'}`)
  if (warningCount.value) parts.push(`${warningCount.value} suggestion${warningCount.value === 1 ? '' : 's'}`)
  return parts.join(' · ')
})

const lead = computed(() =>
  props.source === 'check'
    ? 'Checked this design —'
    : 'Saved — the flow is stored and runnable. Checking the graph found',
)

function dismiss() {
  dismissed.value = true
  emit('dismiss')
}
</script>

<template>
  <div
    v-if="show"
    class="border-b px-4 py-2 text-[13px]"
    :class="
      tone === 'error'
        ? 'border-danger/30 bg-danger-soft text-danger'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    "
  >
    <div class="flex items-center gap-2">
      <Icon :name="tone === 'error' ? 'alert-triangle' : 'info'" :size="15" class="shrink-0" />
      <span>
        {{ lead }} <span class="font-medium">{{ headline }}</span
        >. Nothing is blocked — this is a reading of the graph, so fix what matters and ignore the rest.
      </span>
      <div class="ml-auto flex items-center gap-1">
        <button
          class="rounded-md px-2 py-0.5 text-[12px] font-medium underline-offset-2 hover:underline"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Hide' : 'Show' }} details
        </button>
        <button class="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10" title="Dismiss" @click="dismiss">
          <Icon name="x" :size="14" />
        </button>
      </div>
    </div>

    <ul v-if="expanded" class="mt-2 flex flex-col gap-1.5 pl-[23px]">
      <li v-for="(issue, i) in issues" :key="`${issue.code}-${issue.nodeId ?? i}`" class="flex items-start gap-2">
        <span
          class="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
          :class="issue.severity === 'error' ? 'bg-danger' : 'bg-amber-500'"
          :title="issue.severity"
        />
        <div class="min-w-0">
          <!-- The message already names the node and what is wrong with it; the
               suggestion is written to be read as-is, so neither is reworded. -->
          <div class="text-fg">{{ issue.message }}</div>
          <div v-if="issue.suggestion" class="text-[12px] text-fg-muted">{{ issue.suggestion }}</div>
          <div class="mt-0.5 flex items-center gap-2 text-[11px]">
            <code class="rounded bg-black/5 px-1 py-px text-fg-subtle dark:bg-white/10">{{ issue.code }}</code>
            <button
              v-if="issue.nodeId"
              class="font-medium underline-offset-2 hover:underline"
              :title="`Select the node this is about (${issue.nodeId})`"
              @click="emit('reveal', { nodeId: issue.nodeId, edgeId: issue.edgeId })"
            >
              Show node
            </button>
            <button
              v-if="issue.edgeId"
              class="font-medium underline-offset-2 hover:underline"
              :title="`Select the connection to re-point (${issue.edgeId})`"
              @click="emit('reveal', { edgeId: issue.edgeId })"
            >
              Show connection
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
