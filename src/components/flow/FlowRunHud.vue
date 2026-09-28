<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useFlowLogsStore } from '@/stores/flowLogs'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import { formatMs } from '@/lib/process'

/**
 * The canvas' heads-up display for the run it is painting.
 *
 * The node badges say what each node is doing; this says which process they all
 * belong to — because the stream carries every run on the engine, and a flow can
 * easily have several of its own in flight at once. It names the followed pid,
 * where control is right now, and how the run is going, and it is the control
 * for switching between the live runs on this flow without opening the drawer.
 *
 * It appears only while there is a run to show, so an editor with nothing
 * running keeps the canvas it always had.
 */
const props = defineProps<{ flowId?: string }>()

const logs = useFlowLogsStore()
const graphs = useFlowGraphsStore()

const run = computed(() => logs.canvasRun)
const runs = computed(() => logs.canvasRuns)
const live = computed(() => run.value?.status === 'running')

// A live run's elapsed time has to come from a clock, not from the stream: a run
// that is waiting on a plugin emits nothing for minutes at a time, and a timer
// frozen at the last event would read as a hung editor.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 500)
})
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() => {
  const state = run.value
  if (!state) return ''
  if (state.durationMs !== undefined) return formatMs(state.durationMs)
  if (!state.startedAt) return ''
  return formatMs((live.value ? now.value : (state.finishedAt ?? now.value)) - state.startedAt)
})

const statusTone = computed(() => {
  switch (run.value?.status) {
    case 'running':
      return 'text-sky-500'
    case 'completed':
      return 'text-emerald-500'
    case 'failed':
      return 'text-danger'
    default:
      return 'text-fg-muted'
  }
})

/** Where control is, named from the saved graph — the stream only has ids. */
const cursor = computed(() => {
  const at = run.value?.cursor
  if (!at) return null
  graphs.ensure(at.flow)
  return {
    flow: at.flow,
    node: at.node,
    title: graphs.node(at.flow, at.node)?.title ?? at.node,
    elsewhere: at.flow !== props.flowId,
  }
})

/**
 * A pid was focused in the drawer that has never been in this flow — a run on
 * another workflow, which is routine since the stream carries the whole engine.
 * There is nothing to paint, so say so rather than leaving a blank canvas that
 * looks like the overlay is broken.
 */
const elsewhere = computed(() => {
  const pid = logs.focusedPid
  if (!pid || run.value) return null
  const other = logs.runs[pid]
  return other ? { pid, flow: other.flow } : null
})

/** The pid selector; 'auto' hands the choice back to the store's newest-run rule. */
const pidModel = computed({
  get: () => logs.focusedPid ?? 'auto',
  set: (v: string) => logs.setFocusedPid(v === 'auto' ? null : v),
})

function short(pid: string): string {
  return pid.slice(0, 8)
}
</script>

<template>
  <!-- A run focused in the drawer that this canvas has no part of. -->
  <div
    v-if="elsewhere"
    class="absolute right-3 top-3 z-20 flex max-w-[268px] items-center gap-2 rounded-xl border bg-elevated/95 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-lg backdrop-blur"
  >
    <Icon name="info" :size="13" class="shrink-0 text-fg-subtle" />
    <span class="truncate">
      Run <span class="font-mono">{{ short(elsewhere.pid) }}</span> ran on another flow.
    </span>
    <button class="hud-btn shrink-0" title="Follow the newest run on this flow instead" @click="logs.setFocusedPid(null)">
      Reset
    </button>
  </div>

  <div
    v-if="run"
    class="absolute right-3 top-3 z-20 w-[268px] select-none rounded-xl border bg-elevated/95 text-[12px] shadow-lg backdrop-blur"
  >
    <div class="flex items-center gap-1.5 border-b px-2.5 py-1.5">
      <span class="relative flex h-2 w-2 shrink-0">
        <span
          v-if="live"
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"
        />
        <span class="relative inline-flex h-2 w-2 rounded-full" :class="live ? 'bg-sky-500' : 'bg-fg-subtle'" />
      </span>
      <span class="font-mono text-[11px] text-fg">{{ short(run.pid) }}</span>
      <span class="text-[10px] font-semibold uppercase tracking-wide" :class="statusTone">{{ run.status }}</span>
      <span class="ml-auto tabular-nums text-[11px] text-fg-muted">{{ elapsed }}</span>
      <button
        class="rounded p-0.5 text-fg-subtle transition hover:text-danger"
        title="Clear this run from the canvas"
        @click="logs.clearRuns(run.pid)"
      >
        <Icon name="x" :size="13" />
      </button>
    </div>

    <div class="space-y-1.5 px-2.5 py-2">
      <!-- Where control is. A GoTo can take the run into a flow this canvas is
           not showing, and then the absence of badges needs explaining. -->
      <p v-if="cursor" class="flex items-center gap-1.5 truncate">
        <Icon name="activity" :size="12" class="shrink-0 text-accent" />
        <span v-if="cursor.elsewhere" class="truncate text-fg-muted">
          In another flow — <span class="font-mono">{{ cursor.flow.slice(0, 8) }}</span>
        </span>
        <span v-else class="truncate text-fg" :title="cursor.title">{{ cursor.title }}</span>
      </p>

      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-muted">
        <span v-if="run.counts.running" class="text-sky-500">{{ run.counts.running }} running</span>
        <span v-if="run.counts.ok">{{ run.counts.ok }} done</span>
        <span v-if="run.counts.error" class="text-danger">{{ run.counts.error }} failed</span>
        <span v-if="run.errors.node" class="text-danger" title="Errors the flow's own nodes recorded">
          {{ run.errors.node }} node error{{ run.errors.node === 1 ? '' : 's' }}
        </span>
        <span v-if="run.errors.system" class="text-warning" title="Platform errors — nothing in the flow caused these">
          {{ run.errors.system }} system
        </span>
        <span v-if="run.resumed" class="text-violet-500" title="This run continued an earlier one over the same context">
          resumed
        </span>
      </div>

      <div class="flex items-center gap-1.5 pt-0.5">
        <select
          v-if="runs.length > 1"
          v-model="pidModel"
          class="min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 py-1 text-[11px] text-fg outline-none focus:border-accent"
          title="Which run the canvas follows"
        >
          <option value="auto">Latest run (auto)</option>
          <option v-for="r in runs" :key="r.pid" :value="r.pid">
            {{ short(r.pid) }} · {{ r.status }}
          </option>
        </select>
        <button
          class="hud-btn"
          :class="{ 'hud-btn--on': logs.dimIdleNodes }"
          title="Dim every node this run never touched"
          @click="logs.dimIdleNodes = !logs.dimIdleNodes"
        >
          <Icon name="eye" :size="12" />
          Path
        </button>
        <button class="hud-btn" title="Open the runtime log drawer" @click="logs.open()">
          <Icon name="monitor" :size="12" />
          Logs
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hud-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  border: 1px solid var(--line);
  padding: 4px 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  transition: all 0.15s;
}
.hud-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.hud-btn--on {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}
</style>
