import type { Process, ProcessStatus } from '@/types/api'

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

/**
 * Human duration for a run: the engine-reported durationMs once finished,
 * otherwise the live elapsed time since it started (for a running row), else '—'.
 */
export function formatDuration(p: Process): string {
  let ms = p.durationMs
  if (!ms && p.status === 'running' && p.startedAt) ms = Date.now() - p.startedAt
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}
