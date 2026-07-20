<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useProcessesStore } from '@/stores/processes'
import type { Process, ProcessStatus } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import {
  processStatusClass,
  formatProcessTime,
  formatDuration,
  isStoppable,
} from '@/lib/process'

const store = useProcessesStore()
onMounted(() => store.refresh())

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

// Running first — the default the operator watches.
const filters: { label: string; value: ProcessStatus | '' }[] = [
  { label: 'Running', value: 'running' },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Finished', value: 'finished' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Failed', value: 'failed' },
  { label: 'All', value: '' },
]

const busy = ref(false)
const panelError = ref<string | null>(null)

async function stopRun(p: Process, e?: Event) {
  e?.stopPropagation()
  if (!window.confirm(`Stop process #${p.indexId}? The run on the engine will be cancelled.`)) return
  busy.value = true
  panelError.value = null
  try {
    await store.stop(p.indexId)
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function removeRun(p: Process, e?: Event) {
  e?.stopPropagation()
  if (!window.confirm(`Delete process #${p.indexId} from the list?`)) return
  busy.value = true
  panelError.value = null
  try {
    await store.remove(p.indexId)
  } catch (err) {
    panelError.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

function pretty(value: unknown): string {
  if (value == null) return '—'
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <PageShell
    title="Processes"
    subtitle="Workflow runs on the inflow engine. Running is shown by default — filter for waiting, finished, stopped and the rest. Stop a live run or clear out finished ones."
  >
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <div class="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
        <button
          v-for="f in filters"
          :key="f.value"
          class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
          :class="store.status === f.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'"
          @click="store.setStatus(f.value)"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search by pid or flow…" @input="onSearch" />
      </div>
      <Button icon="refresh" :disabled="store.loading" @click="store.refresh()">Refresh</Button>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local (no engine)' }}</span>
    </div>

    <p v-if="panelError" class="mb-3 text-sm text-danger">{{ panelError }}</p>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading processes…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="monitor"
      title="No processes"
      :description="
        store.isRemote
          ? 'No runs match this filter. Launch a workflow to see it here while it executes.'
          : 'Processes are engine records — connect a backend (VITE_API_BASE_URL) to run workflows and watch them here.'
      "
    />

    <div v-else class="overflow-x-auto rounded-xl border">
      <table class="w-full text-left text-[13px]">
        <thead class="border-b bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
          <tr>
            <th class="px-4 py-2.5 font-semibold">#</th>
            <th class="px-4 py-2.5 font-semibold">Status</th>
            <th class="px-4 py-2.5 font-semibold">Flow</th>
            <th class="px-4 py-2.5 font-semibold">PID</th>
            <th class="px-4 py-2.5 font-semibold">Started</th>
            <th class="px-4 py-2.5 font-semibold">Duration</th>
            <th class="px-4 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in store.items"
            :key="p.indexId"
            class="group cursor-pointer border-b last:border-0 transition-colors hover:bg-surface-2"
            @click="store.open(p)"
          >
            <td class="px-4 py-2.5 font-mono text-fg-muted">{{ p.indexId }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" :class="processStatusClass(p.status)">
                {{ p.status }}
              </span>
            </td>
            <td class="px-4 py-2.5 font-mono text-fg-muted">{{ p.flowId || '—' }}</td>
            <td class="px-4 py-2.5 font-mono text-fg-subtle">{{ p.pid ? p.pid.slice(0, 8) : '—' }}</td>
            <td class="px-4 py-2.5 text-fg-muted">{{ formatProcessTime(p.startedAt || p.scheduledAt) || '—' }}</td>
            <td class="px-4 py-2.5 text-fg-muted">{{ formatDuration(p) }}</td>
            <td class="px-4 py-2.5">
              <div class="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  v-if="isStoppable(p.status)"
                  class="rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger-soft hover:text-danger"
                  title="Stop run"
                  :disabled="busy"
                  @click="stopRun(p, $event)"
                >
                  <Icon name="x" :size="15" />
                </button>
                <button
                  v-else
                  class="rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger-soft hover:text-danger"
                  title="Delete"
                  :disabled="busy"
                  @click="removeRun(p, $event)"
                >
                  <Icon name="trash" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <span class="text-xs text-fg-subtle">Page {{ store.page }} of {{ store.totalPages }} · {{ store.total }} total</span>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>

    <!-- Detail panel -->
    <Modal
      :open="!!store.active"
      :title="store.active ? `Process #${store.active.indexId}` : 'Process'"
      :subtitle="store.active ? `${store.active.status} · pid ${store.active.pid || '—'}` : ''"
      @close="store.close()"
    >
      <div v-if="store.active" class="space-y-4 text-[13px]">
        <dl class="grid grid-cols-3 gap-x-3 gap-y-2">
          <dt class="text-fg-subtle">Status</dt>
          <dd class="col-span-2">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize" :class="processStatusClass(store.active.status)">
              {{ store.active.status }}
            </span>
          </dd>
          <dt class="text-fg-subtle">Flow</dt>
          <dd class="col-span-2 font-mono text-fg">{{ store.active.flowId || '—' }}</dd>
          <dt class="text-fg-subtle">Context</dt>
          <dd class="col-span-2 font-mono text-fg">{{ store.active.contextId || '—' }}</dd>
          <dt class="text-fg-subtle">Start node</dt>
          <dd class="col-span-2 font-mono text-fg">{{ store.active.startNodeId || '—' }}</dd>
          <dt class="text-fg-subtle">PID</dt>
          <dd class="col-span-2 font-mono text-fg break-all">{{ store.active.pid || '—' }}</dd>
          <dt class="text-fg-subtle">Started</dt>
          <dd class="col-span-2 text-fg">{{ formatProcessTime(store.active.startedAt) || '—' }}</dd>
          <dt class="text-fg-subtle">Finished</dt>
          <dd class="col-span-2 text-fg">{{ formatProcessTime(store.active.finishedAt) || '—' }}</dd>
          <dt class="text-fg-subtle">Duration</dt>
          <dd class="col-span-2 text-fg">{{ formatDuration(store.active) }}</dd>
          <template v-if="store.active.scheduledAt">
            <dt class="text-fg-subtle">Scheduled</dt>
            <dd class="col-span-2 text-fg">{{ formatProcessTime(store.active.scheduledAt) }}</dd>
          </template>
        </dl>

        <p v-if="store.active.error" class="rounded-lg bg-danger-soft px-3 py-2 text-danger">{{ store.active.error }}</p>

        <details v-if="store.active.meta">
          <summary class="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Meta</summary>
          <pre class="mt-2 max-h-40 overflow-auto rounded-lg border bg-surface-2 p-3 text-[12px]">{{ pretty(store.active.meta) }}</pre>
        </details>
        <details v-if="store.active.request">
          <summary class="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Request</summary>
          <pre class="mt-2 max-h-40 overflow-auto rounded-lg border bg-surface-2 p-3 text-[12px]">{{ pretty(store.active.request) }}</pre>
        </details>
      </div>

      <template #footer>
        <Button
          v-if="store.active && isStoppable(store.active.status)"
          icon="x"
          :disabled="busy"
          @click="stopRun(store.active)"
        >
          Stop run
        </Button>
        <Button v-else-if="store.active" icon="trash" :disabled="busy" @click="removeRun(store.active)">Delete</Button>
        <Button variant="ghost" @click="store.close()">Close</Button>
      </template>
    </Modal>
  </PageShell>
</template>
