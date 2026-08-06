<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { processesApi } from '@/api/processes'
import { hitlApi } from '@/api/hitl'
import { useFlowLogsStore } from '@/stores/flowLogs'
import Icon from '@/components/ui/Icon.vue'

/**
 * A non-blocking heads-up shown while editing a flow that still has work in
 * flight: runs on the engine (running / waiting / scheduled) or open human tasks
 * — most often a Human-in-the-Loop chat session that has not been closed yet.
 *
 * It only warns; it never blocks editing. Saving a changed flow does not touch
 * runs already dispatched to the engine (they carry their own compiled graph),
 * and a resume launches on the flow as it stands when the task is closed — so the
 * consequences of editing mid-flight are the operator's call, which is exactly
 * what this banner is for. Detection is a plain query, refreshed whenever the
 * live-run count for this flow changes (no standing poll).
 */
const props = defineProps<{ flowId?: string }>()

const router = useRouter()
const logs = useFlowLogsStore()

const activeRuns = ref(0)
const openTasks = ref(0)
const dismissed = ref(false)

const remote = processesApi.isRemote()
// Re-check when a run starts/finishes on this flow (same signal the runs popover
// uses), so the banner clears once nothing is live.
const liveOnFlow = computed(() => logs.liveCountForFlow(props.flowId))

async function check() {
  if (!remote || !props.flowId) {
    activeRuns.value = 0
    openTasks.value = 0
    return
  }
  const flowId = props.flowId
  try {
    const [running, waiting, scheduled, open, answered] = await Promise.all([
      processesApi.list({ flowId, status: 'running', per_page: 1 }),
      processesApi.list({ flowId, status: 'waiting', per_page: 1 }),
      processesApi.list({ flowId, status: 'scheduled', per_page: 1 }),
      hitlApi.list({ flowId, status: 'open', per_page: 1 }),
      hitlApi.list({ flowId, status: 'answered', per_page: 1 }),
    ])
    activeRuns.value = running.total + waiting.total + scheduled.total
    openTasks.value = open.total + answered.total
  } catch {
    // A heads-up that can't load is not worth surfacing an error for.
    activeRuns.value = 0
    openTasks.value = 0
  }
}

const show = computed(() => !dismissed.value && (activeRuns.value > 0 || openTasks.value > 0))

const message = computed(() => {
  const parts: string[] = []
  if (activeRuns.value > 0) parts.push(`${activeRuns.value} run${activeRuns.value === 1 ? '' : 's'} in progress`)
  if (openTasks.value > 0) parts.push(`${openTasks.value} open human task${openTasks.value === 1 ? '' : 's'}`)
  return parts.join(' · ')
})

// A new flow resets the dismissal; the same flow keeps it dismissed for the session.
watch(
  () => props.flowId,
  () => {
    dismissed.value = false
    check()
  },
)
watch(liveOnFlow, check)
onMounted(check)
</script>

<template>
  <div
    v-if="show"
    class="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-700 dark:text-amber-300"
  >
    <Icon name="node-human" :size="15" class="shrink-0" />
    <span>
      This flow has work in flight — <span class="font-medium">{{ message }}</span>. Edits won't disturb runs already
      dispatched, and a parked run resumes on the flow as it stands when its task is closed.
    </span>
    <div class="ml-auto flex items-center gap-1">
      <button
        v-if="openTasks > 0"
        class="rounded-md px-2 py-0.5 text-[12px] font-medium underline-offset-2 hover:underline"
        @click="router.push({ name: 'human-tasks' })"
      >
        Human tasks
      </button>
      <button
        v-if="activeRuns > 0"
        class="rounded-md px-2 py-0.5 text-[12px] font-medium underline-offset-2 hover:underline"
        @click="router.push({ name: 'processes' })"
      >
        Runs
      </button>
      <button class="rounded-md p-1 hover:bg-amber-500/20" title="Dismiss" @click="dismissed = true">
        <Icon name="x" :size="14" />
      </button>
    </div>
  </div>
</template>
