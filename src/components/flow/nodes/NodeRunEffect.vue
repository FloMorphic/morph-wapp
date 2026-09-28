<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { formatMs } from '@/lib/process'
import type { NodeRun } from '@/lib/runState'

/**
 * What one node is doing in the run the canvas is following — the same events
 * the log drawer prints as lines, drawn on the node they are about.
 *
 * Two pieces, rendered as one fragment so both anchor to the node card: a corner
 * badge that always says where the node stands (queued / running / done / failed,
 * with its pass count and the pie chart of a plugin's progress frames), and a
 * band under the header that only appears when there is something to read — the
 * frame text, what a join is still waiting for, a scope fan-out, an error, or a
 * branch `stop_on_error` cut short.
 *
 * It renders nothing at all for a node the run never reached, so a canvas with
 * no run on it looks exactly as it did before.
 */
const props = defineProps<{
  run: NodeRun
  /** The node's own color, for the parts that belong to the node, not the run. */
  accent: string
  /** Whether the followed process is still live — a finished run never spins. */
  live: boolean
}>()

const status = computed(() => props.run.status)
/** A parked join is still `running` on the wire, but it is not working. */
const waiting = computed(() => status.value === 'running' && !!props.run.wait)
const percent = computed(() => props.run.progress?.percent ?? null)

/** Badge tone per state — the one thing that must read from across the canvas. */
const tone = computed(() => {
  if (status.value === 'error') return 'var(--danger)'
  if (waiting.value) return 'var(--warning)'
  if (status.value === 'running') return 'var(--accent)'
  if (status.value === 'ok') return 'var(--success)'
  return 'var(--fg-subtle)'
})

const badgeIcon = computed(() => {
  if (status.value === 'error') return 'x'
  if (waiting.value) return 'node-wait'
  if (status.value === 'ok') return 'check'
  if (status.value === 'running') return 'activity'
  return 'play-circle'
})

const badgeTitle = computed(() => {
  const parts: string[] = []
  if (status.value === 'pending') parts.push('Queued — an inbound edge was taken toward this node')
  if (waiting.value) parts.push(`Waiting on ${props.run.wait?.pending.length ?? 0} of ${props.run.wait?.depends.length ?? 0} branches`)
  else if (status.value === 'running') parts.push(percent.value !== null ? `Running — ${percent.value}%` : 'Running')
  if (status.value === 'ok') parts.push('Completed')
  if (status.value === 'error') parts.push(props.run.error || 'Failed')
  if (props.run.attempts > 1) parts.push(`${props.run.attempts} passes`)
  if (props.run.durationMs !== undefined) parts.push(formatMs(props.run.durationMs))
  if (props.run.waitedMs !== undefined) parts.push(`waited ${formatMs(props.run.waitedMs)}`)
  return parts.join(' · ')
})

/** The duration chip only earns its space once the node has actually settled. */
const duration = computed(() =>
  props.run.durationMs !== undefined && status.value !== 'running' ? formatMs(props.run.durationMs) : '',
)

// The progress pie: one 20×20 ring, drawn with a dash offset rather than an arc
// path so it animates smoothly between frames.
const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const dash = computed(() => `${((percent.value ?? 0) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`)

const frame = computed(() => props.run.progress)
const wait = computed(() => props.run.wait)
const fanout = computed(() => props.run.fanout)
const stopped = computed(() => props.run.stopped)
const errorText = computed(() => props.run.error || props.run.lastError || '')

/** The band is for detail; with none of it, the badge says enough on its own. */
const showBand = computed(
  () =>
    !!frame.value ||
    !!wait.value ||
    !!fanout.value ||
    !!stopped.value ||
    (status.value === 'error' && !!errorText.value),
)
</script>

<template>
  <!-- Corner badge: state, pass count and progress, clear of the node body. -->
  <div
    class="run-badge nodrag absolute -right-2 -top-2 z-20 flex items-center gap-1 rounded-full border px-1 py-0.5 shadow-sm"
    :class="{ 'run-badge--live': live && status === 'running' && !waiting }"
    :style="{
      background: 'var(--elevated)',
      borderColor: `color-mix(in srgb, ${tone} 55%, var(--line))`,
      color: tone,
    }"
    :title="badgeTitle"
  >
    <span class="relative flex h-5 w-5 items-center justify-center">
      <svg v-if="percent !== null" class="absolute inset-0" viewBox="0 0 20 20">
        <circle cx="10" cy="10" :r="RADIUS" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
        <circle
          cx="10"
          cy="10"
          :r="RADIUS"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          :stroke-dasharray="dash"
          transform="rotate(-90 10 10)"
          class="run-ring"
        />
      </svg>
      <span v-if="percent !== null" class="text-[7.5px] font-bold tabular-nums">{{ percent }}</span>
      <Icon v-else :name="badgeIcon" :size="12" />
    </span>
    <!-- A second pass through the same node is a loop or a GoTo re-entry — the
         one thing a static graph cannot show at all. -->
    <span v-if="run.attempts > 1" class="pr-0.5 text-[9px] font-bold tabular-nums">×{{ run.attempts }}</span>
    <span v-else-if="duration" class="pr-0.5 text-[9px] font-semibold tabular-nums opacity-80">{{ duration }}</span>
  </div>

  <!-- Detail band: only what the run is actually saying about this node. -->
  <div v-if="showBand" class="run-band border-t px-2.5 py-1">
    <!-- A plugin's progress frame: the bar, then the frame's own title and text. -->
    <template v-if="frame">
      <div class="run-bar" :style="{ '--run-accent': accent }">
        <span class="run-bar-fill" :style="{ width: `${frame.percent}%` }" />
      </div>
      <p v-if="frame.title" class="mt-1 truncate text-[9.5px] font-semibold text-fg" :title="frame.title">
        {{ frame.title }}
      </p>
      <p v-if="frame.content" class="truncate text-[9.5px] leading-snug text-fg-muted" :title="frame.content">
        {{ frame.content }}
      </p>
    </template>

    <!-- A join parked on the branches it depends on. -->
    <p
      v-if="wait"
      class="flex items-center gap-1 truncate text-[9.5px] font-medium"
      :class="wait.abandonedMs === undefined ? 'text-warning' : 'text-danger'"
      :title="`Depends on ${wait.depends.join(', ')} — still pending: ${wait.pending.join(', ')}`"
    >
      <Icon name="node-wait" :size="10" class="shrink-0" />
      <span class="truncate">
        {{ wait.abandonedMs === undefined ? 'Waiting' : 'Never arrived' }} ·
        {{ wait.depends.length - wait.pending.length }}/{{ wait.depends.length }} branches in
      </span>
    </p>

    <!-- A scope that matched many locations: one node, several passes. -->
    <p
      v-if="fanout"
      class="flex items-center gap-1 truncate text-[9.5px] font-medium text-indigo-500"
      :title="`scope ${fanout.scope} matched ${fanout.count} locations — the node runs once per location`"
    >
      <Icon name="scope" :size="10" class="shrink-0" />
      <span class="truncate">{{ fanout.count }} × {{ fanout.scope }}</span>
    </p>

    <!-- The branch was cut here: its outbound edges were pruned. -->
    <p
      v-if="stopped"
      class="flex items-center gap-1 truncate text-[9.5px] font-semibold text-danger"
      :title="`Branch stopped — ${stopped.cause} (${stopped.pruned} edge${stopped.pruned === 1 ? '' : 's'} pruned)`"
    >
      <Icon name="alert-triangle" :size="10" class="shrink-0" />
      <span class="truncate">Branch stopped · {{ stopped.pruned }} pruned</span>
    </p>

    <p
      v-else-if="status === 'error' && errorText"
      class="truncate text-[9.5px] font-medium text-danger"
      :title="errorText"
    >
      {{ errorText }}
    </p>
  </div>
</template>

<style scoped>
.run-band {
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
}
/* The badge breathes while the node is actually working — the one motion on the
   canvas that means "right now", so nothing else is allowed to pulse. */
.run-badge--live {
  animation: run-badge-pulse 1.4s ease-in-out infinite;
}
@keyframes run-badge-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  }
  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 0%, transparent);
  }
}
.run-ring {
  transition: stroke-dasharray 0.3s ease;
}
.run-bar {
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fg-subtle) 25%, transparent);
  overflow: hidden;
}
.run-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--run-accent);
  transition: width 0.3s ease;
}
@media (prefers-reduced-motion: reduce) {
  .run-badge--live {
    animation: none;
  }
}
</style>
