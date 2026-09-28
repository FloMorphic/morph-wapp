import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  createFlowTracker,
  describeEvent,
  nodeKey,
  type Level,
  type LogCategory,
  type LogDetail,
  type ProcEvent,
} from '@inflowenger/flow-trace'
import { applyEvent, runTouchesFlow, type EdgeRun, type NodeRun, type RunState } from '@/lib/runState'
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
 *   - `runs`      — per-pid node/edge state (see lib/runState), which is what
 *                   paints the run onto the canvas: the same events the drawer
 *                   prints as text, folded into where the process has been, what
 *                   it is doing now, and how far along each node is.
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
  /** Per-pid node/edge state — the canvas' view of the same stream. */
  const runs = ref<Record<string, RunState>>({})
  /**
   * The flow the editor canvas has open, set by the canvas while it is mounted.
   *
   * The canvas asks about node `n_…` of whatever flow it is showing hundreds of
   * times per repaint (one node component each, plus every edge), so the flow it
   * is asking about is held here once and the selected run resolved once, rather
   * than every component re-deriving it from a pid.
   */
  const canvasFlow = ref<string | undefined>(undefined)
  /** Dim nodes the followed run never touched, so its path reads on its own. */
  const dimIdleNodes = ref(false)

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

  /**
   * Empty the drawer. Finished runs go with it — their effects on the canvas are
   * the same history the lines were — but a run still in flight is kept, because
   * clearing the log to watch what happens next should not blind the canvas to
   * the process it is watching.
   */
  function clearMessages(): void {
    messages.value = []
    for (const [pid, run] of Object.entries(runs.value)) {
      if (run.status !== 'running') delete runs.value[pid]
    }
    if (focusedPid.value && !runs.value[focusedPid.value]) focusedPid.value = null
  }

  // Every accepted event becomes a drawer line, already demuxed and seq-ordered
  // — and, in the same pass, is folded into the run state the canvas draws.
  tracker.on('event', (event) => {
    applyEvent(runs.value, event)
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

  // ---- Canvas run view -------------------------------------------------------
  // Which run the canvas paints, and the lookups its node and edge renderers do.

  /** Runs that have been in `flowId`, newest first. The drawer's pid list. */
  function runsForFlow(flowId?: string): RunState[] {
    if (!flowId) return []
    return Object.values(runs.value)
      .filter((run) => runTouchesFlow(run, flowId))
      .sort((a, b) => (b.startedAt ?? b.lastEventAt) - (a.startedAt ?? a.lastEventAt))
  }

  /** Runs on the flow the canvas has open, newest first. */
  const canvasRuns = computed(() => runsForFlow(canvasFlow.value))

  /**
   * The run the canvas is following.
   *
   * The drawer's process filter is the control: focus a pid there and the canvas
   * shows that run, which is the only way to read a canvas at all when several
   * processes are live on one flow. With no pid focused it falls to the newest
   * run that has been in this flow — live if there is one, otherwise the last to
   * have finished, so a run's path is still on screen after it ends.
   *
   * Null when the focused pid never entered this flow: better a blank canvas
   * than one painted with another flow's node ids, which do collide.
   */
  const canvasRun = computed<RunState | null>(() => {
    const flowId = canvasFlow.value
    if (!flowId) return null
    if (focusedPid.value) {
      const run = runs.value[focusedPid.value]
      return run && runTouchesFlow(run, flowId) ? run : null
    }
    const candidates = canvasRuns.value
    return candidates.find((r) => r.status === 'running') ?? candidates[0] ?? null
  })

  /** State for one node of the followed run, or null if it never reached it. */
  function nodeRun(nodeId: string): NodeRun | null {
    const flowId = canvasFlow.value
    if (!flowId) return null
    return canvasRun.value?.nodes[nodeKey(flowId, nodeId)] ?? null
  }

  /**
   * State for one edge of the followed run, keyed by the graph's own edge id.
   *
   * Edge ids are generated per graph, so one is checked against the flow it was
   * decided in before it lights anything up — a run that jumped into another
   * flow must not paint this one's canvas.
   */
  function edgeRun(edgeId: string): EdgeRun | null {
    const state = canvasRun.value?.edges[edgeId]
    if (!state) return null
    return state.from.flow === canvasFlow.value ? state : null
  }

  /** The canvas announces the flow it has open while it is mounted. */
  function setCanvasFlow(flowId: string | undefined): void {
    canvasFlow.value = flowId
  }

  /**
   * Forget one run's effects (or every finished one) without clearing the log.
   *
   * Dropping the run the drawer is focused on releases the focus with it —
   * otherwise the filter would keep pointing at a process that no longer has a
   * chip to unfocus it with.
   */
  function clearRuns(pid?: string): void {
    if (pid) {
      delete runs.value[pid]
      if (focusedPid.value === pid) focusedPid.value = null
      return
    }
    for (const [id, run] of Object.entries(runs.value)) {
      if (run.status !== 'running') delete runs.value[id]
    }
  }

  return {
    connected,
    connecting,
    error,
    messages,
    isOpen,
    focusedPid,
    processes,
    runs,
    canvasFlow,
    canvasRun,
    canvasRuns,
    dimIdleNodes,
    isRemote,
    errorCount,
    liveCountForFlow,
    connect,
    disconnect,
    toggle,
    open,
    close,
    clearMessages,
    clearRuns,
    setFocusedPid,
    setCanvasFlow,
    runsForFlow,
    nodeRun,
    edgeRun,
  }
})
