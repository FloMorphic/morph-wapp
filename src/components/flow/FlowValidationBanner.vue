<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { FlowValidation, FlowValidationIssue } from '@/types/api'

/**
 * What the backend's graph check found, shown over the canvas after a save (or
 * after an explicit Check). The save itself is never refused — the flow in the
 * response is already stored — so this is a reading of the graph an author can
 * act on, not a verdict on their save: dismissible, never modal, and every row
 * jumps to the node (or the edge) whose change would settle it.
 *
 * What a finding costs a RUN is a different question from what it costs the save,
 * and it is the question the banner answers, because an author reading this is
 * deciding whether to carry on or fix it now. There are three answers, not two
 * (`inflow.IsGuardCode` draws the same line on the backend):
 *
 *   - **Lowering errors** (`node_build_failed`, `plugin_account_unresolved`,
 *     `start_node_missing`): the graph did not compile. The engine asks for the
 *     lowered flow when a run starts and the backend has nothing to hand it
 *     (`Diagnostics.CompileErr`), so the run never starts at all.
 *   - **Guard errors** (the `depend_*` family): nothing is refused — the save
 *     stands, the launch goes through — and then the traversal reaches the node
 *     and waits there forever. Cheap to say, expensive to find out: an author
 *     told "nothing is blocked" over a `depend_deadlock` learns about it from a
 *     process that never finishes. The reason the backend does not enforce these
 *     is NOT that they are harmless: it is that they describe ONE traversal, the
 *     one from the flow's start node, while a resumed human task or a Continue
 *     After enters mid-graph on several nodes at once, so the verdict may not be
 *     about the run at hand. Advice to the engine, a real defect to the author.
 *   - **Warnings** (`node_unreachable`): a loose end. A staging area of nodes
 *     nobody has wired up yet is a normal thing to save, and a run is unaffected.
 *
 * None of the three says "blocked", on purpose. The word points both ways here —
 * the backend blocking the author (refusing a save, refusing a launch) and the
 * flow itself blocked on a node — and the second is what a `depend_deadlock` IS,
 * so "nothing is blocked" over one denies the finding it is printed next to. The
 * copy names the outcome instead: does not run / stalls / unaffected.
 *
 * It is grouped BY CODE rather than listing one row per node, because the
 * common findings are per-node and come in bulk: wiring up a flow of thirty
 * nodes from a staging area reports thirty `node_unreachable` warnings that all
 * say the same sentence and want the same fix. One row per kind of finding with
 * a count keeps the banner a few lines tall whatever the graph's size — the
 * canvas underneath is what the author is trying to read — and the nodes of a
 * group stay one click away as chips that reveal them.
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
/** Whether the grouped rows are shown at all — collapsing leaves the one
 *  summary line, for an author who has read the findings and wants the canvas
 *  back without losing them. */
const expanded = ref(true)
/** Which code groups have their node chips open. Collapsed is the default: the
 *  group line already says what is wrong and how many nodes have it. */
const opened = ref(new Set<string>())

// A fresh result is a fresh banner: the author just asked (or just saved), so a
// dismissal of the previous one must not swallow it.
watch(
  () => props.validation,
  () => {
    dismissed.value = false
    expanded.value = true
    opened.value = new Set()
  },
)

const issues = computed<FlowValidationIssue[]>(() => props.validation?.issues ?? [])
const errorCount = computed(() => props.validation?.errorCount ?? 0)
const warningCount = computed(() => props.validation?.warningCount ?? 0)
const show = computed(() => !dismissed.value && issues.value.length > 0)

/** Errors tint the banner red, warnings amber — the same pair the rest of the
 *  app uses for "this will cost you" vs "loose end". */
const tone = computed(() => (errorCount.value > 0 ? 'error' : 'warning'))

/**
 * The guard's own codes — the whole-graph verdicts the backend only ever shows.
 * Kept in sync with `inflow.IsGuardCode`; an error-severity code that is NOT in
 * here is a node that did not lower, which is what stops a run.
 */
const GUARD_CODES = new Set([
  'depend_deadlock',
  'depend_unreachable',
  'depend_unknown_node',
  'depend_self',
  'depend_without_edge',
  'node_unreachable',
])

function isBlocking(issue: FlowValidationIssue): boolean {
  return issue.severity === 'error' && !GUARD_CODES.has(issue.code)
}

/** Findings that keep the flow from running at all — see the note on top. */
const blockingCount = computed(() => issues.value.filter(isBlocking).length)

/**
 * The clause that closes the summary line: the one thing an author needs to know
 * before deciding whether to go back to the canvas or fix this now.
 *
 * The reassuring clause is reserved for a warnings-only result. An error of
 * either kind costs a run, and saying otherwise over a deadlock is a lie the
 * author finds out about later, watching a process hang:
 *
 *   - a node that did not lower → the engine gets no graph, the run never starts;
 *   - a guard error → nothing refuses the launch, the run starts and then sits at
 *     that node, which is worse to debug, not better.
 */
const consequence = computed(() => {
  if (blockingCount.value > 0) {
    return `The flow will not run until ${blockingCount.value === 1 ? 'it is' : 'they are'} fixed.`
  }
  if (errorCount.value > 0) {
    // The save and the launch go through — what stalls is the traversal, and
    // only once it reaches the node, so this is about the run, not the save.
    return errorCount.value === 1
      ? 'The save went through, but a run that reaches it will stall there.'
      : 'The save went through, but a run that reaches them will stall there.'
  }
  return 'Nothing here stops a run.'
})

/**
 * One short line per code, written for the case where the group stands for many
 * nodes — so it says what the finding IS, with no node named (the chips do
 * that) and no sentence repeated N times. A code with no entry here falls back
 * to the backend's own message for the first issue of the group.
 */
const CODE_TITLES: Record<string, string> = {
  node_unreachable: 'Not reachable from the start node, so it never runs',
  node_build_failed: 'Does not compile — the node is missing something it needs',
  plugin_account_unresolved: 'Could not be prepared — the engine is not connected',
  start_node_missing: 'No start node, so there is nothing to run from',
  depend_self: 'Waits for itself, so it can never start',
  depend_deadlock: 'Waits for a step that only runs later — the flow stalls there',
  depend_unreachable: 'Waits for a step the flow never reaches, so it blocks forever',
  depend_unknown_node: 'Waits for a node that is not part of this flow',
  depend_without_edge: 'Waits for a node that has no transition into it',
}

interface IssueGroup {
  code: string
  severity: 'error' | 'warning'
  /** The headline: the code's short line, or the single issue's own message. */
  title: string
  /** The shared fix, shown once for the whole group. */
  suggestion?: string
  /** True when this code is a node that did not lower — see isBlocking. */
  blocking: boolean
  issues: FlowValidationIssue[]
}

/** Errors before warnings, each keeping the backend's order (which is stable
 *  between two compiles of the same graph), so the banner does not churn. */
const groups = computed<IssueGroup[]>(() => {
  const byCode = new Map<string, IssueGroup>()
  for (const issue of issues.value) {
    const existing = byCode.get(issue.code)
    if (existing) {
      existing.issues.push(issue)
      continue
    }
    byCode.set(issue.code, {
      code: issue.code,
      severity: issue.severity,
      title: CODE_TITLES[issue.code] ?? issue.message,
      suggestion: issue.suggestion,
      blocking: isBlocking(issue),
      issues: [issue],
    })
  }
  const all = [...byCode.values()]
  // A group of one has no count to carry, so it reads better as the backend
  // wrote it: that message names the node and, for the depends family, the step
  // it is waiting on.
  for (const g of all) if (g.issues.length === 1) g.title = g.issues[0].message
  return [
    ...all.filter((g) => g.severity === 'error'),
    ...all.filter((g) => g.severity !== 'error'),
  ]
})

const headline = computed(() => {
  const parts: string[] = []
  if (errorCount.value) parts.push(`${errorCount.value} problem${errorCount.value === 1 ? '' : 's'}`)
  if (warningCount.value) parts.push(`${warningCount.value} suggestion${warningCount.value === 1 ? '' : 's'}`)
  return parts.join(' · ')
})

const lead = computed(() => (props.source === 'check' ? 'Checked' : 'Saved'))

/** What to put on a chip: the node's title as the message quotes it, falling
 *  back to a shortened id when the message quotes the id itself. */
function nodeName(issue: FlowValidationIssue): string {
  const quoted = issue.message.match(/"([^"]+)"/)?.[1]?.trim()
  if (quoted && quoted !== issue.nodeId) return quoted
  const id = issue.nodeId ?? ''
  return id.length > 10 ? `${id.slice(0, 9)}…` : id || 'node'
}

function toggle(code: string) {
  const next = new Set(opened.value)
  if (!next.delete(code)) next.add(code)
  opened.value = next
}

function dismiss() {
  dismissed.value = true
  emit('dismiss')
}
</script>

<template>
  <div
    v-if="show"
    class="border-b px-4 py-1.5 text-[12px]"
    :class="
      tone === 'error'
        ? 'border-danger/30 bg-danger-soft text-danger'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    "
  >
    <!-- One line of context, kept to a clause: the detail is in the rows below
         and the canvas is what the author came here to look at. -->
    <div class="flex items-center gap-2">
      <Icon :name="tone === 'error' ? 'alert-triangle' : 'info'" :size="14" class="shrink-0" />
      <span class="truncate">
        {{ lead }} — <span class="font-medium">{{ headline }}</span
        >. {{ consequence }}
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <button
          class="rounded-md px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
          :title="expanded ? 'Keep only this line' : 'Show what was found'"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Hide' : `Show ${groups.length}` }}
        </button>
        <button class="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10" title="Dismiss" @click="dismiss">
          <Icon name="x" :size="13" />
        </button>
      </div>
    </div>

    <!-- One row per kind of finding, whatever the number of nodes behind it.
         Capped in height so a flow with many kinds of finding scrolls here
         instead of pushing the canvas down. -->
    <ul v-if="expanded" class="mt-1 flex max-h-[22vh] flex-col gap-0.5 overflow-y-auto pl-[22px]">
      <li v-for="group in groups" :key="group.code">
        <div class="flex items-center gap-2">
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :class="group.severity === 'error' ? 'bg-danger' : 'bg-amber-500'"
            :title="group.severity"
          />
          <!-- The whole line is the toggle: the nodes it stands for are chips,
               revealed on demand rather than listed by default. -->
          <button
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            :title="`${group.code}${group.suggestion ? ` — ${group.suggestion}` : ''}`"
            @click="toggle(group.code)"
          >
            <span
              v-if="group.issues.length > 1"
              class="shrink-0 rounded bg-black/10 px-1 font-medium tabular-nums dark:bg-white/15"
              >{{ group.issues.length }} nodes</span
            >
            <!-- What this row costs a run, since the two kinds read the same
                 otherwise: a node that will not compile stops the run from
                 starting, a guard error lets it start and stall. -->
            <span
              v-if="group.blocking"
              class="shrink-0 rounded bg-danger px-1 font-medium text-white"
              title="The flow cannot be compiled while this stands, so a run cannot start"
              >run won't start</span
            >
            <span
              v-else-if="group.severity === 'error'"
              class="shrink-0 rounded bg-black/10 px-1 font-medium dark:bg-white/15"
              title="Nothing refuses the launch — the run starts and then waits here forever"
              >run stalls here</span
            >
            <span class="truncate text-fg">{{ group.title }}</span>
            <span v-if="group.suggestion" class="hidden truncate text-fg-muted sm:inline">— {{ group.suggestion }}</span>
            <Icon
              :name="opened.has(group.code) ? 'chevron-down' : 'chevron-right'"
              :size="13"
              class="shrink-0 opacity-60"
            />
          </button>
        </div>

        <!-- The nodes of this group: each chip selects and frames its node (and
             the edge to re-point, where the finding names one). -->
        <div v-if="opened.has(group.code)" class="mb-1 ml-[14px] flex flex-wrap gap-1 pt-1">
          <button
            v-for="(issue, i) in group.issues"
            :key="`${issue.nodeId ?? i}`"
            class="max-w-[14rem] truncate rounded border border-current/25 px-1.5 py-px font-medium hover:bg-black/5 dark:hover:bg-white/10"
            :title="issue.suggestion ? `${issue.message} — ${issue.suggestion}` : issue.message"
            @click="emit('reveal', { nodeId: issue.nodeId, edgeId: issue.edgeId })"
          >
            {{ nodeName(issue) }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
