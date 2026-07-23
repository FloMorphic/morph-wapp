<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import FlowRefText from '@/components/flow/FlowRefText.vue'
import { useFlowLogsStore, type FlowLogMessage, type LogLevel } from '@/stores/flowLogs'
import { useFlowGraphsStore } from '@/stores/flowGraphs'
import { useNotificationsStore } from '@/stores/notifications'
import { processesApi } from '@/api/processes'

/**
 * Bottom, resizable drawer showing the live runtime log stream for the editor.
 *
 * Reads everything from the flowLogs store (one shared socket + tracker). The
 * readable "pretty" view is the default because it is what you scan; the raw
 * event stays one click away because this is an inspector — a summary you can't
 * check against the wire is useless when debugging the engine itself.
 */
const store = useFlowLogsStore()
const graphs = useFlowGraphsStore()
const router = useRouter()
const notifications = useNotificationsStore()

const drawerHeight = ref(300)
const logContainer = ref<HTMLElement | null>(null)
const filterLevel = ref<LogLevel | 'all'>('all')
const filterKind = ref<string>('all')
const searchQuery = ref('')
const viewMode = ref<'pretty' | 'raw'>('pretty')
const expanded = ref<Set<string>>(new Set())
const copiedId = ref<string | null>(null)

function startResize(event: MouseEvent) {
  const startY = event.clientY
  const startHeight = drawerHeight.value
  function onMove(e: MouseEvent) {
    drawerHeight.value = Math.max(140, Math.min(window.innerHeight - 120, startHeight + (startY - e.clientY)))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Auto-scroll to the newest line unless the user has scrolled up to read.
const stickToBottom = ref(true)
function onScroll() {
  const el = logContainer.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
watch(
  () => store.messages.length,
  async () => {
    if (!stickToBottom.value) return
    await nextTick()
    if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
  },
)

/** A plugin sub-classifies some `log` events; the category wins for badging. */
function displayKind(msg: FlowLogMessage): string | undefined {
  return msg.category ?? msg.kind
}

const availableKinds = computed(() => {
  const kinds = new Set<string>()
  for (const m of store.messages) {
    const k = displayKind(m)
    if (k) kinds.add(k)
  }
  return [...kinds].sort()
})

const availablePids = computed(() => {
  const pids = new Map<string, number>()
  for (const m of store.messages) {
    if (m.pid) pids.set(m.pid, (pids.get(m.pid) ?? 0) + 1)
  }
  return [...pids.entries()].map(([pid, count]) => ({ pid, count }))
})

const pidFilter = computed({
  get: () => store.focusedPid ?? 'all',
  set: (v: string) => store.setFocusedPid(v === 'all' ? null : v),
})

const levelCounts = computed(() => {
  const counts: Record<string, number> = { all: store.messages.length, debug: 0, info: 0, warn: 0, error: 0 }
  for (const m of store.messages) counts[m.level] = (counts[m.level] ?? 0) + 1
  return counts
})

const filteredMessages = computed(() => {
  let result = store.messages
  if (store.focusedPid) result = result.filter((m) => m.pid === store.focusedPid)
  if (filterLevel.value !== 'all') result = result.filter((m) => m.level === filterLevel.value)
  if (filterKind.value !== 'all') result = result.filter((m) => displayKind(m) === filterKind.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (m) =>
        m.message.toLowerCase().includes(q) ||
        m.kind?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        m.src?.toLowerCase().includes(q) ||
        m.nodeTitle?.toLowerCase().includes(q) ||
        m.nodeId?.toLowerCase().includes(q) ||
        // What the row actually shows for its node — the title off the saved
        // graph — is searchable too, but only for flows already resolved.
        (m.nodeId ? graphs.node(m.flow, m.nodeId)?.title.toLowerCase().includes(q) : false) ||
        m.flow?.toLowerCase().includes(q),
    )
  }
  return result
})

function formatTime(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

function levelIcon(level: LogLevel): string {
  switch (level) {
    case 'warn':
      return 'alert-triangle'
    case 'error':
      return 'x'
    default:
      return 'info'
  }
}

/** Level → left-border + icon colour classes. */
const levelBar: Record<LogLevel, string> = {
  info: 'border-l-sky-500',
  warn: 'border-l-amber-500',
  error: 'border-l-red-500',
  debug: 'border-l-violet-500',
}
const levelText: Record<LogLevel, string> = {
  info: 'text-sky-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
  debug: 'text-violet-500',
}

function kindLabel(kind?: string): string {
  if (!kind) return ''
  return kind.replace(/^(node|proc|edge|flow|dep)\./, '')
}

/** Group kinds by meaning so the badge colour carries information. */
function kindClass(kind?: string): string {
  if (!kind) return 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
  if (kind === 'proc.start' || kind === 'proc.finish') return 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
  if (kind === 'edge.select' || kind === 'flow.jump') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
  if (kind.startsWith('node.')) return 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
  // A join parked on its inbound branches vs. one released — the pair reads as
  // a state change, so colour them as one (amber = waiting, emerald = through).
  if (kind === 'dep.wait') return 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
  if (kind === 'dep.ready') return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
  if (kind === 'progress') return 'bg-teal-500/20 text-teal-600 dark:text-teal-300'
  if (kind === 'protocol') return 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
  if (kind === 'log') return 'bg-fg-subtle/15 text-fg-muted'
  return 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
}

/**
 * `edge.select` names its own source in the message (`from … → to …`), so the
 * node chip would print the same node twice on those rows.
 */
function showNodeChip(msg: FlowLogMessage): boolean {
  return !!msg.nodeId && msg.kind !== 'edge.select'
}

function rawJson(msg: FlowLogMessage): string {
  return msg.event ? JSON.stringify(msg.event, null, 2) : JSON.stringify({ message: msg.message }, null, 2)
}

function isExpandable(msg: FlowLogMessage): boolean {
  return msg.event !== undefined
}

function toggleExpand(msg: FlowLogMessage) {
  if (!isExpandable(msg)) return
  const next = new Set(expanded.value)
  next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id)
  expanded.value = next
}

async function copyRow(msg: FlowLogMessage) {
  try {
    await navigator.clipboard.writeText(rawJson(msg))
    copiedId.value = msg.id
    setTimeout(() => copiedId.value === msg.id && (copiedId.value = null), 1200)
  } catch {
    /* clipboard unavailable */
  }
}

/** A process lifecycle row — the anchor for jumping to the run's context. */
function isProcRow(msg: FlowLogMessage): boolean {
  return !!msg.pid && (msg.kind === 'proc.start' || msg.kind === 'proc.finish')
}

// The stream only carries the pid; resolve it to the run's contextId through
// the process record, then land on the context page to evaluate what the run
// wrote.
const resolvingPid = ref<string | null>(null)
async function openRunContext(msg: FlowLogMessage) {
  if (!msg.pid || resolvingPid.value) return
  resolvingPid.value = msg.pid
  try {
    const page = await processesApi.list({ pid: msg.pid, per_page: 1 })
    const contextId = page.list[0]?.contextId
    if (contextId) {
      router.push({ name: 'context-detail', params: { id: contextId } })
    } else {
      notifications.notify({ level: 'warning', message: 'No process record (or context) found for this run.' })
    }
  } catch (err) {
    notifications.notify({ level: 'error', message: (err as Error).message })
  } finally {
    resolvingPid.value = null
  }
}

/** Export what's on screen as JSONL — the shape the engine emits and tools read. */
async function copyAll() {
  const jsonl = filteredMessages.value
    .map((m) => (m.event ? JSON.stringify(m.event) : null))
    .filter(Boolean)
    .join('\n')
  try {
    await navigator.clipboard.writeText(jsonl)
    copiedId.value = '__all__'
    setTimeout(() => copiedId.value === '__all__' && (copiedId.value = null), 1200)
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <transition name="drawer">
    <div
      v-if="store.isOpen"
      class="absolute inset-x-0 bottom-0 z-40 flex flex-col border-t border-line bg-surface shadow-lg"
      :style="{ height: drawerHeight + 'px' }"
    >
      <!-- Resize handle -->
      <div
        class="absolute -top-1 inset-x-0 h-2 cursor-ns-resize hover:bg-accent-soft"
        title="Drag to resize"
        @mousedown.stop="startResize"
      />

      <!-- Header -->
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div class="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Icon name="monitor" :size="16" class="text-accent" />
          <span>Runtime Logs</span>
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="
              store.connected
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : store.connecting
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-red-500/15 text-red-600 dark:text-red-400'
            "
          >
            {{ store.connected ? 'Live' : store.connecting ? 'Connecting…' : 'Offline' }}
          </span>
          <span
            v-if="store.errorCount > 0"
            class="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold text-danger"
            :title="`${store.errorCount} error events`"
          >
            {{ store.errorCount }} error{{ store.errorCount === 1 ? '' : 's' }}
          </span>
        </div>

        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            v-if="availablePids.length > 0"
            v-model="pidFilter"
            class="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
            title="Focus one process"
          >
            <option value="all">All processes{{ availablePids.length > 1 ? ` (${availablePids.length})` : '' }}</option>
            <option v-for="p in availablePids" :key="p.pid" :value="p.pid">
              {{ p.pid.slice(0, 8) }}… ({{ p.count }})
            </option>
          </select>

          <select
            v-model="filterLevel"
            class="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
            title="Filter by severity"
          >
            <option value="all">All levels ({{ levelCounts.all }})</option>
            <option value="info">Info ({{ levelCounts.info }})</option>
            <option value="warn">Warn ({{ levelCounts.warn }})</option>
            <option value="error">Error ({{ levelCounts.error }})</option>
            <option value="debug">Debug ({{ levelCounts.debug }})</option>
          </select>

          <select
            v-if="availableKinds.length > 0"
            v-model="filterKind"
            class="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
            title="Filter by event kind"
          >
            <option value="all">All kinds</option>
            <option v-for="k in availableKinds" :key="k" :value="k">{{ k }}</option>
          </select>

          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search…"
            class="w-36 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-fg outline-none focus:border-accent"
          />

          <div class="inline-flex overflow-hidden rounded-lg border border-line">
            <button
              class="px-2 py-1 text-[11px] font-semibold"
              :class="viewMode === 'pretty' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'"
              @click="viewMode = 'pretty'"
            >
              Pretty
            </button>
            <button
              class="px-2 py-1 text-[11px] font-semibold"
              :class="viewMode === 'raw' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'"
              @click="viewMode = 'raw'"
            >
              JSON
            </button>
          </div>

          <button class="drawer-icon-btn" title="Copy visible events as JSONL" @click="copyAll">
            <Icon :name="copiedId === '__all__' ? 'check' : 'copy'" :size="14" />
          </button>
          <button
            v-if="!store.connected && !store.connecting"
            class="drawer-icon-btn"
            title="Reconnect"
            @click="store.connect()"
          >
            <Icon name="refresh" :size="14" />
          </button>
          <button class="drawer-icon-btn" title="Clear logs" @click="store.clearMessages()">
            <Icon name="trash" :size="14" />
          </button>
          <button class="drawer-icon-btn" title="Close" @click="store.close()">
            <Icon name="x" :size="16" />
          </button>
        </div>
      </div>

      <!-- Body -->
      <div ref="logContainer" class="flex-1 overflow-y-auto py-1 font-mono text-[12px]" @scroll="onScroll">
        <div v-if="filteredMessages.length === 0" class="flex flex-col items-center gap-2 py-10 text-fg-subtle">
          <Icon name="monitor" :size="30" :stroke-width="1.5" />
          <p class="text-[13px] font-medium">No logs yet</p>
          <span v-if="!store.connected" class="text-[11px]">Not connected. Run a flow to see logs.</span>
        </div>

        <!-- Raw -->
        <template v-else-if="viewMode === 'raw'">
          <div
            v-for="msg in filteredMessages"
            :key="msg.id"
            class="group relative border-b border-line/60 px-3 py-1"
          >
            <button
              class="absolute right-1.5 top-1 text-fg-subtle opacity-0 transition group-hover:opacity-100 hover:text-accent"
              title="Copy this event"
              @click.stop="copyRow(msg)"
            >
              <Icon :name="copiedId === msg.id ? 'check' : 'copy'" :size="13" />
            </button>
            <pre
              class="overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-snug"
              :class="msg.level === 'error' ? 'text-red-500' : 'text-fg-muted'"
              >{{ rawJson(msg) }}</pre
            >
          </div>
        </template>

        <!-- Pretty -->
        <template v-else>
          <div
            v-for="msg in filteredMessages"
            :key="msg.id"
            class="group border-l-[3px] px-3 py-1 hover:bg-surface-2"
            :class="[levelBar[msg.level] ?? 'border-l-transparent', isExpandable(msg) ? 'cursor-pointer' : '']"
            @click="toggleExpand(msg)"
          >
            <div class="flex flex-wrap items-baseline gap-2">
              <span class="w-2.5 text-[9px] text-fg-subtle">{{
                isExpandable(msg) ? (expanded.has(msg.id) ? '▾' : '▸') : ''
              }}</span>
              <span class="text-[11px] text-fg-subtle">{{ formatTime(msg.timestamp) }}</span>
              <span v-if="msg.seq !== undefined" class="text-[10px] tabular-nums text-fg-subtle">#{{ msg.seq }}</span>
              <Icon :name="levelIcon(msg.level)" :size="12" :class="levelText[msg.level]" />
              <span
                v-if="displayKind(msg)"
                class="rounded px-1.5 text-[9px] font-bold uppercase tracking-wide"
                :class="kindClass(displayKind(msg))"
                >{{ kindLabel(displayKind(msg)) }}</span
              >
              <span v-if="msg.src && msg.src !== 'rt'" class="text-[10px] text-accent">{{ msg.src }}</span>
              <FlowRefText
                v-if="showNodeChip(msg)"
                class="text-[11px] text-fg-muted"
                :text="msg.nodeId!"
                :flow="msg.flow"
                :fallback="msg.nodeTitle"
              />
              <FlowRefText class="text-fg" :text="msg.message" :flow="msg.flow" :fallback="msg.nodeTitle" />
              <button
                v-if="isExpandable(msg)"
                class="ml-auto text-fg-subtle opacity-0 transition group-hover:opacity-100 hover:text-accent"
                title="Copy this event as JSON"
                @click.stop="copyRow(msg)"
              >
                <Icon :name="copiedId === msg.id ? 'check' : 'copy'" :size="13" />
              </button>
              <button
                v-if="isProcRow(msg)"
                class="flex items-center gap-1 text-[10px] font-semibold text-fg-subtle transition hover:text-accent"
                :class="{ 'ml-auto': !isExpandable(msg) }"
                title="Open this run's context"
                @click.stop="openRunContext(msg)"
              >
                <Icon name="context" :size="13" />
                {{ resolvingPid === msg.pid ? '…' : 'context' }}
              </button>
            </div>
            <pre
              v-if="expanded.has(msg.id)"
              class="ml-6 mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-2 text-[11px] leading-snug text-fg"
              >{{ rawJson(msg) }}</pre
            >
          </div>
        </template>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.drawer-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--fg-muted);
  transition: all 0.15s;
}
.drawer-icon-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateY(16px);
}
</style>
