<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Process } from '@/types/api'
import { processesApi } from '@/api/processes'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import { processStatusClass, formatProcessTime, formatDuration, isStoppable } from '@/lib/process'

/**
 * Toolbar affordance for the workflow editor: the runs currently live on the
 * flow being edited. Keeps its own small state (not the Processes page store) so
 * the two never fight, and refreshes on a light interval so the count stays
 * current while the flow is open. Only meaningful against a connected backend —
 * hidden in local (no-engine) mode.
 */
const props = defineProps<{ flowId?: string }>()

const remote = processesApi.isRemote()
const runs = ref<Process[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const showPanel = ref(false)
const busy = ref(false)

const REFRESH_MS = 8000
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  if (!remote || !props.flowId) {
    runs.value = []
    total.value = 0
    return
  }
  loading.value = true
  error.value = null
  try {
    // Running + waiting are the "live on this flow" states worth surfacing.
    const [running, waiting] = await Promise.all([
      processesApi.list({ flowId: props.flowId, status: 'running', per_page: 50 }),
      processesApi.list({ flowId: props.flowId, status: 'waiting', per_page: 50 }),
    ])
    runs.value = [...running.list, ...waiting.list]
    total.value = running.total + waiting.total
  } catch (err) {
    error.value = (err as Error).message
    runs.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function stopRun(p: Process) {
  if (!window.confirm(`Stop process #${p.indexId}?`)) return
  busy.value = true
  try {
    await processesApi.stop(p.indexId)
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  load()
  if (remote) timer = setInterval(load, REFRESH_MS)
})
onUnmounted(() => timer && clearInterval(timer))
watch(() => props.flowId, load)
</script>

<template>
  <!-- Only when a saved flow is open against a backend. -->
  <div v-if="remote && flowId">
    <Button
      icon="monitor"
      :title="total ? `${total} live run(s) on this flow` : 'No live runs on this flow'"
      @click="showPanel = true"
    >
      <span class="hidden sm:inline">Runs</span>
      <span
        v-if="total"
        class="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-sky-500/15 px-1.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400"
      >
        {{ total }}
      </span>
    </Button>

    <Modal
      :open="showPanel"
      title="Live runs on this flow"
      :subtitle="total ? `${total} running / waiting` : 'Nothing live right now'"
      @close="showPanel = false"
    >
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-[12px] text-fg-subtle">Auto-refreshes every {{ REFRESH_MS / 1000 }}s.</p>
          <Button icon="refresh" :disabled="loading" @click="load">Refresh</Button>
        </div>

        <p v-if="error" class="text-sm text-danger">{{ error }}</p>

        <p v-if="!loading && runs.length === 0" class="rounded-lg border border-dashed px-4 py-8 text-center text-[13px] text-fg-muted">
          No running or waiting processes on this flow.
        </p>

        <div v-else class="divide-y rounded-lg border">
          <div v-for="p in runs" :key="p.indexId" class="flex items-center gap-3 px-3 py-2.5 text-[13px]">
            <span class="font-mono text-fg-muted">#{{ p.indexId }}</span>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" :class="processStatusClass(p.status)">
              {{ p.status }}
            </span>
            <span class="font-mono text-[12px] text-fg-subtle">{{ p.pid ? p.pid.slice(0, 8) : '—' }}</span>
            <span class="text-[12px] text-fg-subtle">{{ formatProcessTime(p.startedAt) }}</span>
            <span class="ml-auto text-[12px] text-fg-muted">{{ formatDuration(p) }}</span>
            <button
              v-if="isStoppable(p.status)"
              class="rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger-soft hover:text-danger"
              title="Stop run"
              :disabled="busy"
              @click="stopRun(p)"
            >
              <Icon name="x" :size="15" />
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="showPanel = false">Close</Button>
      </template>
    </Modal>
  </div>
</template>
