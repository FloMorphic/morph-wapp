import type {
  Page,
  PaginationParams,
  Trigger,
  TriggerKind,
  ScheduleTrigger,
  WebhookTrigger,
} from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Workflow trigger repository. A trigger (inbound webhook or recurring schedule)
 * is what launches a workflow from the outside. It is stored entirely apart from
 * the flow graph — never in `view_flow` / `node.data` — because it carries
 * secrets, a public URL lifecycle, and delivery history that must not live in the
 * editable, exportable graph document. It only *references* the flow + entry node
 * by id (`flowId`, `startNodeId`).
 *
 * Uses the morph-api `/trigger` endpoints when a backend is configured, otherwise
 * persists to localStorage so the Start drawer works standalone. Both paths return
 * identical {@link Trigger} shapes — with the caveat that the local path cannot
 * mint a real public URL or actually fire schedules (there is no server), so those
 * read-only, backend-computed fields (`url`, `nextAt`, `recentHits`) are simulated
 * or left empty.
 */

const LOCAL_KEY = 'triggers'

export interface TriggerListParams extends PaginationParams {
  /** Scope the list to one flow's triggers. */
  flowId?: string
  /** Scope to one kind (`webhook` | `schedule`). */
  kind?: TriggerKind
}

/** Run context + settings every trigger carries (see {@link TriggerBase}). */
interface SaveContextInput {
  contextMode: Trigger['contextMode']
  contextId?: string
  contextTitle?: string
  settings?: Trigger['settings']
}

/** Fields a caller supplies to create/update a webhook trigger. `id` present =
 *  update. Read-only fields (`url`, `hasSecret`, `recentHits`) are never sent. */
export interface SaveWebhookInput
  extends SaveContextInput,
    Partial<Pick<WebhookTrigger, 'id' | 'slug' | 'methods' | 'auth' | 'whitelistIp'>> {
  flowId: string
  startNodeId: string
  title: string
  enabled: boolean
}

export interface SaveScheduleInput
  extends SaveContextInput,
    Partial<Pick<ScheduleTrigger, 'id' | 'cron' | 'intervalSec' | 'timezone'>> {
  flowId: string
  startNodeId: string
  title: string
  enabled: boolean
  mode: ScheduleTrigger['mode']
}

export type SaveTriggerInput =
  | ({ kind: 'webhook' } & SaveWebhookInput)
  | ({ kind: 'schedule' } & SaveScheduleInput)

// ---- Local backend ----------------------------------------------------------

function localAll(): Trigger[] {
  return readCollection<Trigger>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Redact the write-only secret from a webhook for list responses (the single
 *  {@link localGet} keeps it, mirroring the backend's reveal-on-get). */
function redactTrigger(t: Trigger): Trigger {
  if (t.kind === 'webhook' && t.auth?.secret) {
    return { ...t, auth: { ...t.auth, secret: undefined }, hasSecret: true }
  }
  return t
}

function localList(params?: TriggerListParams): Page<Trigger> {
  let all = localAll()
  if (params?.flowId) all = all.filter((t) => t.flowId === params.flowId)
  if (params?.kind) all = all.filter((t) => t.kind === params.kind)
  const search = params?.search?.toLowerCase()
  if (search) all = all.filter((t) => t.title.toLowerCase().includes(search))
  const perPage = params?.per_page ?? 50
  const page = Math.max(1, params?.page ?? 1)
  const start = (page - 1) * perPage
  return {
    list: all.slice(start, start + perPage).map(redactTrigger),
    total: all.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(all.length / perPage)),
  }
}

/** Strip the write-only secret before persisting locally, and derive the same
 *  read-only view fields the backend would (a simulated public URL, a
 *  `hasSecret` flag). Keeps the local shape faithful to the wire shape. */
function localMaterialize(input: SaveTriggerInput, existing?: Trigger): Trigger {
  const ts = now()
  const base = {
    id: input.id ?? createId('trg'),
    flowId: input.flowId,
    startNodeId: input.startNodeId,
    title: input.title,
    enabled: input.enabled,
    contextMode: input.contextMode,
    contextId: input.contextMode === 'existing' ? (input.contextId ?? '') : undefined,
    contextTitle: input.contextMode === 'new' ? (input.contextTitle ?? '') : undefined,
    settings: input.settings,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  }
  if (input.kind === 'webhook') {
    const prev = existing?.kind === 'webhook' ? existing : undefined
    const auth = { ...input.auth } as WebhookTrigger['auth']
    // Keep the stored secret when the caller leaves it blank (an edit that did not
    // touch the write-only field). localStorage is inherently local, so we retain
    // the value here — reopening the settings can reveal it, mirroring the
    // backend's single-record read.
    if ((auth.secret == null || auth.secret === '') && prev?.auth?.secret) {
      auth.secret = prev.auth.secret
    }
    const hasSecret = auth.secret != null && auth.secret !== ''
    const slug = input.slug || prev?.slug || base.id
    return {
      ...base,
      kind: 'webhook',
      slug,
      methods: input.methods ?? prev?.methods ?? [],
      auth,
      whitelistIp: input.whitelistIp ?? prev?.whitelistIp ?? [],
      url: `${localHookOrigin()}/hooks/${slug}`,
      hasSecret,
      recentHits: prev?.recentHits ?? [],
    }
  }
  const prev = existing?.kind === 'schedule' ? existing : undefined
  return {
    ...base,
    kind: 'schedule',
    mode: input.mode,
    cron: input.cron ?? prev?.cron ?? '',
    intervalSec: input.intervalSec ?? prev?.intervalSec ?? 0,
    timezone: input.timezone ?? prev?.timezone ?? '',
    nextAt: 0,
    lastAt: prev?.lastAt ?? 0,
  }
}

/** Best-effort origin for the simulated local webhook URL — the app's own origin
 *  in the browser, a placeholder otherwise. Purely cosmetic in standalone mode. */
function localHookOrigin(): string {
  if (typeof window !== 'undefined' && window.location) return window.location.origin
  return 'https://your-morph-host'
}

function localSave(input: SaveTriggerInput): Trigger {
  const all = readCollection<Trigger>(LOCAL_KEY)
  if (input.id) {
    const idx = all.findIndex((t) => t.id === input.id)
    if (idx >= 0) {
      const updated = localMaterialize(input, all[idx])
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record = localMaterialize(input)
  all.push(record)
  writeCollection(LOCAL_KEY, all)
  return record
}

function localGet(id: string): Trigger {
  const found = localAll().find((t) => t.id === id)
  if (!found) throw new Error(`Trigger ${id} not found`)
  return found
}

function localRemove(id: string): void {
  writeCollection(
    LOCAL_KEY,
    readCollection<Trigger>(LOCAL_KEY).filter((t) => t.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const triggersApi = {
  isRemote: apiEnabled,

  list(params?: TriggerListParams): Promise<Page<Trigger>> {
    if (apiEnabled()) return list<Trigger>('/trigger', params)
    return Promise.resolve(localList(params))
  },

  /** Convenience: every trigger bound to one flow, newest first. */
  async listForFlow(flowId: string): Promise<Trigger[]> {
    const page = await this.list({ flowId, per_page: 200 })
    return page.list
  },

  get(id: string): Promise<Trigger> {
    if (apiEnabled()) return http.get<Trigger>(`/trigger/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  save(input: SaveTriggerInput): Promise<Trigger> {
    if (apiEnabled()) return http.post<Trigger>('/trigger', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/trigger/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },
}
