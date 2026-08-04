/**
 * The Human-in-the-Loop node's design-time contract — the shape the drawer
 * edits, the node catalog previews, and the backend compiler lowers into the
 * Extrinsic's operation payload (`op`) on `svc.hitl.add`.
 *
 * Why this shape and not a live one: an Extrinsic svc handler runs outside the
 * flow's expression scope and cannot resolve context variables. So everything a
 * human session needs is decided here, at design time, and shipped whole; the
 * handler records it on the Human Task together with the run identity
 * (pid / flowId / nodeId / contextId), the scoped data snapshot, and the node's
 * outbound edges. The prompt is therefore stored as an unresolved TEMPLATE and
 * only filled in later — when a person opens the session and the conversation
 * begins — against the snapshot the node captured.
 */

import type { BaseNodeData } from '@/data/nodeCatalog'

/**
 * What the svc handler answers with when the run reaches the node.
 *
 *   park     → a `stop` command: the runtime drops this node's next and the run
 *              finishes here. The captured outbound edges (`nexts` on the task)
 *              are what a resume run rebuilds its start from once the session is
 *              closed — the same park/resume shape the Continue After node uses.
 *   continue → a plain success reply with no command: the task is recorded (so a
 *              person can pick it up out of band) and the flow carries straight
 *              on through this node's next.
 */
export type HitlMode = 'park' | 'continue'

/** Where the conversation with the person happens. */
export type HitlChannel = 'direct' | 'telegram' | 'whatsapp'

/** One named pointer into the run's context, resolved when the session opens. */
export interface HitlRef {
  id: string
  /** Label the session shows the captured value under. */
  name: string
  /** JSONPath into the node's captured data, e.g. `$.messages`. */
  path: string
}

/** One thing the person has to answer before the task counts as answered. */
export interface HitlQuestion {
  id: string
  text: string
}

export const HITL_MODES: { id: HitlMode; label: string; icon: string; hint: string }[] = [
  {
    id: 'park',
    label: 'Park',
    icon: 'node-until',
    hint: 'The run stops at this node and the workflow gets its finish signal. The outbound nodes are captured with the task, and the flow resumes from them once the session is closed.',
  },
  {
    id: 'continue',
    label: 'Continue',
    icon: 'play',
    hint: 'The task is recorded and the flow carries straight on through this node’s next — the person picks the record up out of band, without the run waiting for them.',
  },
]

export const HITL_CHANNELS: {
  id: HitlChannel
  label: string
  icon: string
  available: boolean
  hint: string
}[] = [
  {
    id: 'direct',
    label: 'Direct chat',
    icon: 'prompt',
    available: true,
    hint: 'The conversation happens in FloMorphic: the person clicks the task and answers in an in-app chat.',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: 'send',
    available: false,
    hint: 'The session is delivered as a Telegram conversation (needs a bot integration).',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: 'phone',
    available: false,
    hint: 'The session is delivered as a WhatsApp conversation (needs a Business API integration).',
  },
]

/** The node-data keys this node owns beyond the universal ones. */
export const HITL_DATA_KEYS = ['mode', 'prompt', 'refs', 'questions', 'channel'] as const

/** The `{{$.path}}` variables written in a prompt, de-duplicated, in order. */
export function detectPromptRefs(prompt: string): string[] {
  const found: string[] = []
  for (const m of prompt.matchAll(/\{\{\s*(\$[^}\s]*)\s*\}\}/g)) {
    const path = m[1]
    if (path && !found.includes(path)) found.push(path)
  }
  return found
}

/**
 * A name for a newly recorded reference: the path's last segment, made unique
 * against the names already taken. An empty path yields `ref`, `ref2`, …
 */
export function suggestRefName(path: string, existing: { name: string }[]): string {
  const segments = path.replace(/\[\d+\]/g, '').split('.').filter((s) => s && s !== '$')
  const base = segments[segments.length - 1] || 'ref'
  const taken = new Set(existing.map((r) => r.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}${i}`)) i += 1
  return `${base}${i}`
}

/** The refs array, created in place so the editor mutates the node's own array. */
export function hitlRefs(data: BaseNodeData): HitlRef[] {
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.refs)) d.refs = []
  const arr = d.refs as HitlRef[]
  for (const r of arr) {
    r.name ??= ''
    r.path ??= ''
  }
  return arr
}

/** The questions array, same in-place contract as {@link hitlRefs}. */
export function hitlQuestions(data: BaseNodeData): HitlQuestion[] {
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.questions)) d.questions = []
  const arr = d.questions as HitlQuestion[]
  for (const q of arr) {
    q.text ??= ''
  }
  return arr
}

/**
 * Bring a node authored before this contract up to it.
 *
 * The first HITL drawer collected `operationData` key/value rows — which the
 * backend compiler never read, so they were never asked of anyone. They are the
 * closest thing the old node had to questions, so they are folded in as such
 * (the row's value is the question text, its key the question id) and the dead
 * field is dropped. Missing mode/channel default to the safe pair: park, and
 * the one channel that exists.
 */
export function migrateHitlData(data: BaseNodeData): void {
  const d = data as Record<string, unknown>
  const legacy = d.operationData
  if (Array.isArray(legacy)) {
    const questions = hitlQuestions(data)
    if (questions.length === 0) {
      for (const [i, raw] of legacy.entries()) {
        const row = (raw ?? {}) as Record<string, unknown>
        const text = String(row.value ?? '').trim()
        if (!text) continue
        questions.push({ id: String(row.key ?? '').trim() || `q${i + 1}`, text })
      }
    }
    delete d.operationData
  }
  if (d.mode !== 'continue') d.mode = 'park'
  if (typeof d.prompt !== 'string') d.prompt = ''
  if (!HITL_CHANNELS.some((c) => c.id === d.channel)) d.channel = 'direct'
  hitlRefs(data)
  hitlQuestions(data)
}
