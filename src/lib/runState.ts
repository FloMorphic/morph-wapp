import {
  edgeKey,
  nodeKey,
  type DepReadyFields,
  type DepWaitFields,
  type EdgeSelectDetail,
  type ErrorKind,
  type FinishStatus,
  type FlowJumpDetail,
  type LogDetail,
  type NodeEnterDetail,
  type NodeExitDetail,
  type NodeRef,
  type ProcEvent,
  type ProcFinishDetail,
  type ProcStartDetail,
  type ProgressLogFields,
  type ScopeFanoutFields,
  type StopOnErrorFields,
} from '@inflowenger/flow-trace'

/**
 * Per-process run state, folded out of the v1 process event stream — the canvas'
 * half of what the log drawer shows as text.
 *
 * Why this exists next to flow-trace's own `FlowTracker` state: the tracker
 * already keys node/edge state on `flow:node` and would serve a path view as-is,
 * but it mutates plain objects in place behind an event API, and it deliberately
 * drops everything a `log` event carries (progress frames, join waits, scope
 * fan-out, recorded errors) into a generic `fields` bag. The canvas wants the
 * opposite of both: one reactive object Vue can watch, with the log detail that
 * actually renders on a node already lifted out of the bag and typed.
 *
 * So this is a reducer, not a second tracker: it folds the *raw* events the
 * tracker has already validated, ordered and demuxed ({@link FlowTracker} emits
 * them on `event`), and it never talks to the socket itself.
 *
 * Node state is keyed on `flow:node` like the tracker's, because one process
 * spans several flows via GoTo and a node id is unique only within its flow.
 * Edge state is keyed on the graph's own edge id where there is one, so the
 * canvas can look up the edge it is already drawing; a runtime-synthesised jump
 * has no edge id and falls back to its endpoints.
 */

/** How a node stands in one run. Mirrors flow-trace's `NodeStatus`. */
export type NodeRunStatus = 'pending' | 'running' | 'ok' | 'error'

export type RunStatus = 'running' | FinishStatus

/** A join parked on the branches it depends on (`dep.wait` / `dep.ready`). */
export interface JoinWait {
  depends: string[]
  pending: string[]
  since: number
  /** Set when the runtime gave up waiting — the branches will never arrive. */
  abandonedMs?: number
}

/** The latest sub-100% frame a plugin published for a node (`progress`). */
export interface NodeProgress {
  percent: number
  title: string
  content: string
  at: number
}

/** One node of one run, as the canvas draws it. */
export interface NodeRun extends NodeRef {
  /** `flow:node` — the key this is stored under. */
  key: string
  status: NodeRunStatus
  /** Compiled type / title, as reported by `node.enter`. */
  type?: string
  title?: string
  /** Passes through this node. >1 is a loop or a GoTo re-entry. */
  attempts: number
  enteredAt?: number
  exitedAt?: number
  durationMs?: number
  error?: string
  progress?: NodeProgress
  wait?: JoinWait
  /** Milliseconds a join actually waited, once its dependencies arrived. */
  waitedMs?: number
  /** A `scope` that matched several locations: the node ran once per location. */
  fanout?: { scope: string; count: number }
  /** Errors this node recorded, split by whose they are. */
  errors: { node: number; system: number }
  /** The last error message recorded against the node, whatever its kind. */
  lastError?: string
  /** Set when `stop_on_error` cut the branch here — nothing continues past it. */
  stopped?: { pruned: number; cause: string }
  /** Last time anything about this node changed — drives the "most recent" pick. */
  at: number
}

/** One routing decision's worth of edge state. */
export interface EdgeRun {
  key: string
  /** The graph's edge id. Empty for an edge the runtime synthesised (a GoTo). */
  edgeId: string
  from: NodeRef
  to: NodeRef
  tags: string[]
  /** Sticky: control crossed this edge at least once. */
  taken: boolean
  takenCount: number
  /** Decided against at least once. A loop can prune an edge it once took. */
  pruned: boolean
  /** When the most recent decision about this edge was reported. */
  at: number
  /** Seq of the most recent *traversal* — changes only when control moves. */
  seq: number
}

/** Everything one pid did, as far as the stream has said. */
export interface RunState {
  pid: string
  status: RunStatus
  /** The flow the run entered at. */
  flow?: string
  /** The node the run entered at. */
  entryNode?: string
  /** Every flow the run has been seen in, entry first (GoTo appends). */
  flows: string[]
  /** The flow the run is in right now — the last one it entered a node in. */
  currentFlow?: string
  /** Where control is (or last was): the most recently entered node. */
  cursor?: NodeRef & { at: number }
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  error?: string
  /** A run continuing an earlier one over the same context. */
  resumed?: boolean
  nodes: Record<string, NodeRun>
  edges: Record<string, EdgeRun>
  /** Totals for the run HUD — cheaper than rescanning `nodes` on every event. */
  counts: { running: number; ok: number; error: number }
  /** Recorded errors across the whole run, by whose they are. */
  errors: { node: number; system: number }
  lastEventAt: number
  lastSeq: number
}

/**
 * How many runs to keep. The stream carries every process on the engine, so an
 * editor left open all day would otherwise accumulate state for runs nobody is
 * looking at. Finished runs are dropped first — a running one is still news.
 */
const MAX_RUNS = 24

export function createRun(pid: string): RunState {
  return {
    pid,
    status: 'running',
    flows: [],
    nodes: {},
    edges: {},
    counts: { running: 0, ok: 0, error: 0 },
    errors: { node: 0, system: 0 },
    lastEventAt: 0,
    lastSeq: -1,
  }
}

function ensureRun(runs: Record<string, RunState>, pid: string): RunState {
  let run = runs[pid]
  if (!run) {
    run = createRun(pid)
    runs[pid] = run
  }
  return run
}

function ensureNode(run: RunState, ref: NodeRef): NodeRun {
  const key = nodeKey(ref)
  let node = run.nodes[key]
  if (!node) {
    node = {
      key,
      flow: ref.flow,
      node: ref.node,
      status: 'pending',
      attempts: 0,
      errors: { node: 0, system: 0 },
      at: 0,
    }
    run.nodes[key] = node
  }
  return node
}

/** The node this event is about, or undefined for a process-scoped one. */
function refOf(event: ProcEvent): NodeRef | undefined {
  return event.flow !== undefined && event.node !== undefined
    ? { flow: event.flow, node: event.node }
    : undefined
}

function seeFlow(run: RunState, flow: string): void {
  if (!run.flows.includes(flow)) run.flows.push(flow)
}

/**
 * Drop the oldest runs once past {@link MAX_RUNS}, finished ones first.
 *
 * Called when a new run starts, which is the only moment the set grows.
 */
function prune(runs: Record<string, RunState>): void {
  const all = Object.values(runs)
  if (all.length <= MAX_RUNS) return
  const disposable = all
    .filter((r) => r.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? a.lastEventAt) - (b.finishedAt ?? b.lastEventAt))
  let over = all.length - MAX_RUNS
  for (const run of disposable) {
    if (over-- <= 0) break
    delete runs[run.pid]
  }
}

/**
 * Fold one already-validated event into `runs`, in place.
 *
 * Unknown kinds and categories are ignored on purpose: a newer engine may emit
 * things this build has never heard of, and a canvas that threw on them would
 * be worse than one that just doesn't draw them.
 */
export function applyEvent(runs: Record<string, RunState>, event: ProcEvent): void {
  const run = ensureRun(runs, event.pid)
  run.lastEventAt = event.ts
  run.lastSeq = event.seq
  const ref = refOf(event)
  if (ref) seeFlow(run, ref.flow)

  switch (event.kind) {
    case 'proc.start': {
      const detail = event.detail as ProcStartDetail | undefined
      run.status = 'running'
      run.startedAt = event.ts
      run.finishedAt = undefined
      run.durationMs = undefined
      run.error = undefined
      if (detail?.flow) {
        run.flow = detail.flow
        run.currentFlow = detail.flow
        seeFlow(run, detail.flow)
      }
      if (detail?.node) run.entryNode = detail.node
      if (detail?.flow && detail?.node) {
        const node = ensureNode(run, { flow: detail.flow, node: detail.node })
        node.at = event.ts
      }
      prune(runs)
      break
    }

    case 'proc.finish': {
      const detail = event.detail as ProcFinishDetail | undefined
      run.status = detail?.status ?? 'completed'
      run.finishedAt = event.ts
      run.durationMs = detail?.durationMs
      run.error = detail?.error
      // A run can end with nodes still marked running — a branch cut short, a
      // stop, a crash. Leaving them pulsing would claim work is still happening.
      for (const node of Object.values(run.nodes)) {
        if (node.status !== 'running') continue
        node.status = run.status === 'completed' ? 'ok' : 'error'
        node.progress = undefined
        node.at = event.ts
      }
      recount(run)
      break
    }

    case 'node.enter': {
      if (!ref) break
      const detail = event.detail as NodeEnterDetail | undefined
      const node = ensureNode(run, ref)
      node.status = 'running'
      node.type = detail?.type ?? node.type
      node.title = detail?.title ?? node.title
      node.attempts = detail?.attempt ?? node.attempts + 1
      node.enteredAt = event.ts
      node.exitedAt = undefined
      node.durationMs = undefined
      node.error = undefined
      // Each pass is its own story: a re-entered node must not show the last
      // pass' progress frame, stop marker or fan-out count.
      node.progress = undefined
      node.wait = undefined
      node.waitedMs = undefined
      node.fanout = undefined
      node.stopped = undefined
      node.at = event.ts
      run.cursor = { ...ref, at: event.ts }
      run.currentFlow = ref.flow
      recount(run)
      break
    }

    case 'node.exit': {
      if (!ref) break
      const detail = event.detail as NodeExitDetail | undefined
      const node = ensureNode(run, ref)
      node.status = detail?.status === 'error' ? 'error' : 'ok'
      node.exitedAt = event.ts
      node.durationMs = detail?.durationMs
      node.error = detail?.error
      node.progress = undefined
      node.wait = undefined
      node.at = event.ts
      recount(run)
      break
    }

    case 'edge.select': {
      if (!ref) break
      const detail = event.detail as EdgeSelectDetail | undefined
      if (!detail) break
      for (const edge of detail.pruned ?? []) {
        const state = ensureEdge(run, ref, edge, event.ts)
        state.pruned = true
        state.at = event.ts
      }
      for (const edge of detail.taken ?? []) {
        const state = ensureEdge(run, ref, edge, event.ts)
        state.taken = true
        state.takenCount += 1
        state.at = event.ts
        state.seq = event.seq
        // The target exists in the run from the moment control is heading for
        // it — that is what draws a node as queued before it reports entering.
        const target = ensureNode(run, { flow: edge.flow, node: edge.node })
        if (target.status !== 'running') {
          target.status = 'pending'
          target.at = event.ts
        }
        seeFlow(run, edge.flow)
      }
      break
    }

    case 'flow.jump': {
      const detail = event.detail as FlowJumpDetail | undefined
      if (!detail?.to) break
      const target = ensureNode(run, detail.to)
      if (target.status !== 'running') {
        target.status = 'pending'
        target.at = event.ts
      }
      seeFlow(run, detail.to.flow)
      // A jump is a traversal with no edge on anyone's canvas, so it is recorded
      // by its endpoints alone — enough for a path view to show the hop.
      if (ref) {
        const key = edgeKey(ref, detail.to)
        const state = run.edges[key] ?? {
          key,
          edgeId: '',
          from: ref,
          to: detail.to,
          tags: [],
          taken: false,
          takenCount: 0,
          pruned: false,
          at: event.ts,
          seq: event.seq,
        }
        state.taken = true
        state.takenCount += 1
        state.at = event.ts
        state.seq = event.seq
        run.edges[key] = state
      }
      break
    }

    case 'log':
      applyLog(run, event, ref)
      break

    default:
      // A kind from a newer engine. Nothing to draw, nothing to break.
      break
  }
}

/**
 * Edge state, keyed by the graph's edge id where there is one.
 *
 * The id is what the canvas is already drawing, so keying on it is what lets a
 * decision light up the right line. A GoTo's jump target has no edge id — it
 * was never drawn by anyone — and falls back to its endpoints.
 */
function ensureEdge(
  run: RunState,
  from: NodeRef,
  edge: { flow: string; node: string; edgeId: string; tags: string[] },
  at: number,
): EdgeRun {
  const to: NodeRef = { flow: edge.flow, node: edge.node }
  const key = edge.edgeId || edgeKey(from, to)
  let state = run.edges[key]
  if (!state) {
    state = {
      key,
      edgeId: edge.edgeId ?? '',
      from,
      to,
      tags: edge.tags ?? [],
      taken: false,
      takenCount: 0,
      pruned: false,
      at,
      seq: -1,
    }
    run.edges[key] = state
  }
  if (edge.tags?.length) state.tags = edge.tags
  return state
}

/**
 * Lift the parts of a `log` event that belong on a node out of the detail bag.
 *
 * Only the categories the canvas draws are read; a plain diagnostic (no
 * category) still counts toward the node's error tally when it is one of the
 * run's own recorded errors — an error-level log carrying neither `kind` nor
 * `code` is somebody logging loudly, not the run failing, and is left alone.
 */
function applyLog(run: RunState, event: ProcEvent, ref?: NodeRef): void {
  const detail = (event.detail ?? {}) as LogDetail
  const node = ref ? ensureNode(run, ref) : undefined

  if (event.level === 'error' && typeof detail.code === 'number' && detail.kind) {
    const kind: ErrorKind = detail.kind === 'system' ? 'system' : 'node'
    run.errors[kind] += 1
    if (node) {
      node.errors[kind] += 1
      node.lastError = typeof detail.msg === 'string' ? detail.msg : node.lastError
      node.at = event.ts
    }
  }

  switch (detail.category) {
    case 'progress': {
      if (!node) break
      const fields = detail as unknown as ProgressLogFields
      const percent = Number(fields.percent)
      if (!Number.isFinite(percent)) break
      node.progress = {
        percent: Math.max(0, Math.min(100, percent)),
        title: fields.frame?.title ?? '',
        content: fields.frame?.content ?? '',
        at: event.ts,
      }
      node.at = event.ts
      break
    }
    case 'dep.wait': {
      if (!node) break
      const fields = detail as unknown as DepWaitFields
      node.wait = {
        depends: fields.depends ?? [],
        pending: fields.pending ?? [],
        since: event.ts,
        // The variant carrying `waitedMs` is the runtime giving up: the branches
        // it was waiting for will never arrive now.
        abandonedMs: fields.waitedMs,
      }
      node.at = event.ts
      break
    }
    case 'dep.ready': {
      if (!node) break
      const fields = detail as unknown as DepReadyFields
      node.wait = undefined
      node.waitedMs = fields.waitedMs
      node.at = event.ts
      break
    }
    case 'scope.fanout': {
      if (!node) break
      const fields = detail as unknown as ScopeFanoutFields
      node.fanout = { scope: fields.scope ?? '', count: Number(fields.count) || 0 }
      node.at = event.ts
      break
    }
    case 'stop.on.error': {
      if (!node) break
      const fields = detail as unknown as StopOnErrorFields
      node.stopped = { pruned: Number(fields.pruned) || 0, cause: fields.cause ?? '' }
      node.at = event.ts
      break
    }
    case 'resume':
      // The applied variant carries counts; the skipped one only a message.
      run.resumed = typeof detail.seededNodes === 'number'
      break
    default:
      break
  }
}

function recount(run: RunState): void {
  let running = 0
  let ok = 0
  let error = 0
  for (const node of Object.values(run.nodes)) {
    if (node.status === 'running') running += 1
    else if (node.status === 'ok') ok += 1
    else if (node.status === 'error') error += 1
  }
  run.counts = { running, ok, error }
}

/** Whether a run ever touched `flowId` — true for the flow it jumped into too. */
export function runTouchesFlow(run: RunState, flowId: string): boolean {
  return run.flow === flowId || run.flows.includes(flowId)
}
