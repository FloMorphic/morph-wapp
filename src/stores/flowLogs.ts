import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  createFlowTracker,
  describeEvent,
  type Level,
  type LogCategory,
  type LogDetail,
  type ProcEvent,
} from '@inflowenger/flow-trace'
import { apiBaseUrl, apiEnabled, getAuthToken } from '@/api/client'
import { useNotificationsStore } from '@/stores/notifications'
import { useHitlStore } from '@/stores/hitl'
import { useWorkflowsStore } from '@/stores/workflows'

/**
 * Live runtime log stream for the workflow editor.
 *
 * The engine publishes a v1 process-event stream; flomorphic-api relays every
 * event verbatim over a WebSocket (see api/wslog). This store owns the single
 * socket, feeds the raw stream through `@inflowenger/flow-trace` (which demuxes
 * by pid, orders by seq and validates), and exposes:
 *   - `messages`  — one display line per accepted event, for the log drawer.
 *   - `processes` — per-pid lifecycle, so a flow's live-run count is derived
 *                   from the stream instead of polling `/process`.
 *
 * Modelled on flomorphic-api's useSocketIO composable, adapted to a Pinia
 * singleton so the drawer and the toolbar badge share one connection.
 */

export type LogLevel = Level

/** One line in the log drawer. `event` is the raw event off the wire. */
export interface FlowLogMessage {
  id: string
  timestamp: number
  level: LogLevel
  message: string
  event?: ProcEvent
  pid?: string
  seq?: number
  kind?: string
  /** Sub-kind of a `log` event (progress / protocol / dep.*), drives the badge. */
  category?: LogCategory
  src?: string
  flow?: string
  nodeId?: string
  nodeTitle?: string
}

/** Per-process lifecycle distilled from the stream — enough for a live badge. */
export interface LiveProcess {
  pid: string
  /** The flow the run entered at (proc.start). Scopes the editor's live count. */
  flow?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt?: number
  finishedAt?: number
}

/** Cap on retained log lines — a looping flow emits without bound. */
const MAX_MESSAGES = 5000

/** A fixed session label; the backend route (/ws/:id) only uses it as a name. */
const SOCKET_PATH = '/ws/flomorphic'

export const useFlowLogsStore = defineStore('flowLogs', () => {
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref<string | null>(null)
  const messages = ref<FlowLogMessage[]>([])
  const isOpen = ref(false)
  /** Which process the drawer is focused on; null shows all. */
  const focusedPid = ref<string | null>(null)
  /** Per-pid lifecycle, keyed by pid. */
  const processes = ref<Record<string, LiveProcess>>({})

  // The tracker owns mutable internal state — keep it out of Vue's reactivity
  // and subscribe to its typed events instead.
  const tracker = createFlowTracker()
  let socket: Socket | null = null

  const isRemote = apiEnabled()
  const errorCount = computed(() => messages.value.filter((m) => m.level === 'error').length)

  /** Running processes that entered on `flowId` — the editor's live badge. */
  function liveCountForFlow(flowId?: string): number {
    if (!flowId) return 0
    return Object.values(processes.value).filter(
      (p) => p.status === 'running' && p.flow === flowId,
    ).length
  }

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  function pushMessage(msg: Omit<FlowLogMessage, 'id'>): void {
    messages.value.push({ id: generateId(), ...msg })
    if (messages.value.length > MAX_MESSAGES) {
      messages.value.splice(0, messages.value.length - MAX_MESSAGES)
    }
  }

  /** A local notice — not from the engine, so it has no raw event. */
  function addMessage(msg: { level: LogLevel; message: string }): void {
    pushMessage({ timestamp: Date.now(), ...msg })
  }

  function clearMessages(): void {
    messages.value = []
  }

  // Every accepted event becomes a drawer line, already demuxed and seq-ordered.
  tracker.on('event', (event) => {
    pushMessage({
      timestamp: event.ts,
      level: event.level,
      // Ids, not titles: the drawer resolves them against the saved graph as it
      // renders (see FlowRefText.vue / flowGraphs.ts).
      message: describeEvent(event),
      event,
      pid: event.pid,
      seq: event.seq,
      kind: event.kind,
      category: event.kind === 'log' ? (event.detail as LogDetail | undefined)?.category : undefined,
      src: event.src,
      flow: event.flow,
      nodeId: event.node,
      // The only title on the wire: `node.enter` reports the compiled node's
      // title. Every other reference is resolved from the saved graph on render.
      nodeTitle: (event.detail as any)?.title,
    })
  })

  // Lifecycle → the live-process map that drives the toolbar badge.
  tracker.on('start', ({ pid, entry, at }) => {
    processes.value[pid] = {
      pid,
      flow: entry?.flow,
      status: 'running',
      startedAt: at,
    }
  })
  tracker.on('finish', ({ pid, status, at }) => {
    const prev = processes.value[pid]
    processes.value[pid] = {
      pid,
      flow: prev?.flow,
      status,
      startedAt: prev?.startedAt,
      finishedAt: at,
    }
  })

  tracker.on('gap', ({ pid, from, count }) => {
    addMessage({
      level: 'warn',
      message: `Lost ${count} event${count === 1 ? '' : 's'} from #${from} (pid ${pid.slice(0, 8)}…)`,
    })
  })

  tracker.on('skip', ({ reason, input }) => {
    if (reason === 'legacy') {
      addMessage({
        level: 'warn',
        message: 'Ignored a pre-v1 log event — this engine predates the current log format.',
      })
      return
    }
    if (reason === 'malformed' || reason === 'unsupported-version') {
      addMessage({ level: 'warn', message: `Ignored an unusable event (${reason})` })
      return
    }
    // Connection banners and other non-event traffic are normal; only surface
    // things that look like they were meant to be events.
    if (typeof input === 'string' && input.length > 0) {
      addMessage({ level: 'debug', message: input })
    }
  })

  function connect(): void {
    if (!isRemote) {
      error.value = 'No backend configured'
      return
    }
    if (socket?.connected || connecting.value) return
    if (socket) {
      connecting.value = true
      error.value = null
      socket.connect()
      return
    }

    const token = getAuthToken()
    connecting.value = true
    error.value = null

    socket = io(apiBaseUrl(), {
      transports: ['websocket'],
      path: SOCKET_PATH,
      // Match the HTTP client: send the bearer when one exists, otherwise
      // connect unauthenticated (local dev has no token).
      query: token ? { Authorization: token } : undefined,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      connected.value = true
      connecting.value = false
      error.value = null
      addMessage({ level: 'info', message: 'Connected to runtime log stream' })
    })

    socket.on('disconnect', (reason: string) => {
      connected.value = false
      connecting.value = false
      addMessage({ level: 'warn', message: `Disconnected: ${reason}` })
      // A dropped connection means any hole in the stream will never be filled;
      // don't leave processes stuck mid-flight behind it.
      tracker.flush()
    })

    socket.on('connect_error', (err: Error) => {
      connected.value = false
      connecting.value = false
      error.value = err.message
      addMessage({ level: 'error', message: `Connection error: ${err.message}` })
    })

    // The engine's stream, relayed verbatim by flomorphic-api. The tracker
    // decides what is usable.
    socket.on('message', (payload: unknown) => tracker.ingest(payload))
    socket.on('log', (payload: unknown) => tracker.ingest(payload))

    // API-originated outcomes (scheduler launches, action results) arrive on a
    // separate `notification` event and surface as toasts, not drawer lines.
    const notifications = useNotificationsStore()
    socket.on('notification', (payload: unknown) => notifications.ingest(payload))

    // Human-in-the-Loop conversation turns pushed by the chat service. The store
    // applies one only when it is about a task it is currently showing, so an
    // open conversation panel refreshes without polling. Resolved lazily to keep
    // this store free of a hard dependency on the hitl store.
    socket.on('hitl.message', (payload: unknown) => useHitlStore().ingestSocketTask(payload))
    // Incremental tokens of the bot's reply, rendered live in the panel.
    socket.on('hitl.stream', (payload: unknown) => useHitlStore().ingestStreamChunk(payload))

    // A workflow was created/updated out-of-band (an MCP client, another tab, the
    // scheduler). The workflows store refreshes its list when loaded so the flow
    // appears without a manual reload, and records the change for the editor to
    // observe. Resolved lazily to avoid a hard dependency on the workflows store.
    socket.on('flow.changed', (payload: unknown) => useWorkflowsStore().ingestFlowChanged(payload))
  }

  function disconnect(): void {
    if (socket) {
      socket.disconnect()
      socket = null
    }
    connected.value = false
    connecting.value = false
  }

  function toggle(): void {
    isOpen.value = !isOpen.value
    if (isOpen.value) connect()
  }
  function open(): void {
    isOpen.value = true
    connect()
  }
  function close(): void {
    isOpen.value = false
  }

  function setFocusedPid(pid: string | null): void {
    focusedPid.value = pid
  }

  return {
    connected,
    connecting,
    error,
    messages,
    isOpen,
    focusedPid,
    processes,
    isRemote,
    errorCount,
    liveCountForFlow,
    connect,
    disconnect,
    toggle,
    open,
    close,
    clearMessages,
    setFocusedPid,
  }
})
