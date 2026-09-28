import type { Process, ProcessStatus, RunErrorItem, RunErrorKind, RunErrors } from '@/types/api'

/** Tailwind classes for a status pill, one per lifecycle state. */
export function processStatusClass(status: ProcessStatus): string {
  return {
    running: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    waiting: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    scheduled: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    finished: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    stopped: 'bg-slate-500/15 text-fg-muted',
    failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  }[status]
}

/** A run is stoppable while it is live on the engine (or still queued). */
export function isStoppable(status: ProcessStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'scheduled'
}

/** The lineage of a run started by closing a Human-in-the-Loop task. */
export interface ResumeOrigin {
  /** The pid of the run that parked at the HITL node. */
  sourcePid: string
  /** The HITL node the source run parked at. */
  sourceNodeId: string
  /** The human task whose close released this run. */
  humanTaskId: string
}

/**
 * Read the HITL-resume lineage off a process, or null for an ordinary run.
 * `inflow.ResumeHumanTask` stamps `origin: "hitl_resume"` and the source ids into
 * the run's record meta, so a resumed run can say where it came from — it is a
 * new pid, entered on the parked node's next edges, not a continuation of the old
 * pid on the engine.
 */
export function resumeOrigin(p: Process): ResumeOrigin | null {
  const meta = p.meta
  if (!meta || meta.origin !== 'hitl_resume') return null
  return {
    sourcePid: String(meta.sourcePid ?? ''),
    sourceNodeId: String(meta.sourceNodeId ?? ''),
    humanTaskId: String(meta.humanTaskId ?? ''),
  }
}

/** Short absolute timestamp, or '' for a zero (unset) time. */
export function formatProcessTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Human duration for a span of milliseconds — `250ms`, `1.4s`, `2m 5s`. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

/**
 * Human duration for a run: the engine-reported durationMs once finished,
 * otherwise the live elapsed time since it started (for a running row), else '—'.
 */
export function formatDuration(p: Process): string {
  let ms = p.durationMs
  if (!ms && p.status === 'running' && p.startedAt) ms = Date.now() - p.startedAt
  if (!ms) return '—'
  return formatMs(ms)
}

/* ---- Run error ledger ------------------------------------------------------
 * What the engine stamped into the run's context header under `_errors`, lifted
 * onto the process row by the backend. A node error does not stop a flow, so a
 * finished run can still carry a ledger — these helpers are what let the list
 * say so instead of reporting a clean completion.
 */

/**
 * The run's error ledger, or null when there is nothing to show.
 *
 * Presence of the field is not the test: a clean run has no `errors` at all, and
 * a run off an engine that predates the ledger can answer with an empty object.
 * Having a count is.
 */
export function processErrors(p: Process): RunErrors | null {
  const errs = p.errors
  if (!errs) return null
  const items = Array.isArray(errs.items) ? errs.items : []
  const count = errs.count || items.length
  if (count === 0) return null
  return { pid: errs.pid ?? '', count, items }
}

/** Normalized kind — anything the engine does not name is the flow's own. */
export function errorKind(item: RunErrorItem): RunErrorKind {
  return item.kind === 'system' ? 'system' : 'node'
}

/**
 * How many entries of each kind the ledger carries.
 *
 * Counted over the kept items, not `count`: the cap drops the tail, and a split
 * derived from what is in hand is the only one that can be trusted to add up to
 * what is on screen.
 */
export function errorKindCounts(items: RunErrorItem[]): Record<RunErrorKind, number> {
  const counts: Record<RunErrorKind, number> = { node: 0, system: 0 }
  for (const item of items) counts[errorKind(item)] += 1
  return counts
}

/** Tailwind classes for a kind badge. The two are deliberately different tones:
 * only one of them is something the flow author can act on. */
export function errorKindClass(kind: RunErrorKind): string {
  return kind === 'system'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-red-500/15 text-red-600 dark:text-red-400'
}

/** One-line summary for a tag's tooltip — "3 errors · 2 node, 1 system". */
export function errorSummary(errs: RunErrors): string {
  const { node, system } = errorKindCounts(errs.items)
  const parts: string[] = []
  if (node) parts.push(`${node} node`)
  if (system) parts.push(`${system} system`)
  const head = `${errs.count} error${errs.count === 1 ? '' : 's'} recorded during this run`
  return parts.length ? `${head} · ${parts.join(', ')}` : head
}

/** Clock time with seconds — the errors of one run land seconds apart, so the
 * list-level `formatProcessTime` (minutes) cannot order them. */
export function formatErrorTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
