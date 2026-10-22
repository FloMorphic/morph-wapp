import type {
  CompiledFlow,
  FlowEntryView,
  FlowPreferences,
  FlowRecord,
  Page,
  PaginationParams,
  VueFlowGraph,
} from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { resolveEntryViewLocally } from '@/lib/flowEntry'
import { createId, now } from '@/lib/id'

/**
 * Flow repository. Uses the flomorphic-api `/flow` endpoints when a backend is
 * configured, otherwise persists to localStorage so the app works standalone.
 * Both paths return identical {@link FlowRecord} shapes.
 */

const LOCAL_KEY = 'flows'

export interface SaveFlowInput {
  id?: string
  title: string
  view_flow: VueFlowGraph
  /** The flow's labels. Omit (undefined) and the backend keeps whatever is
   *  stored — a save that knows nothing about tags must not strip the ones a
   *  package stamped on the flow; `[]` clears them. */
  tags?: string[]
  /** The flow's preferences (its entry form). Same contract as the tags: omit
   *  and the stored ones are kept, which is why a canvas save — which knows
   *  nothing about the form — never has to send it. `{}` clears them. */
  preferences?: FlowPreferences
}

// ---- Local backend ----------------------------------------------------------

function localList(params?: PaginationParams): Page<FlowRecord> {
  const all = readCollection<FlowRecord>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
  const search = params?.search?.toLowerCase()
  const wanted = normalizeTags(params?.tags?.split(','))
  const filtered = all.filter(
    (f) =>
      (!search || f.title.toLowerCase().includes(search)) &&
      // Match ANY, the same contract as the backend's tag predicate.
      (wanted.length === 0 || (f.tags ?? []).some((t) => wanted.includes(t))),
  )
  const perPage = params?.per_page ?? 12
  const page = Math.max(1, params?.page ?? 1)
  const start = (page - 1) * perPage
  const list = filtered.slice(start, start + perPage)
  return {
    list,
    total: filtered.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(filtered.length / perPage)),
  }
}

function localGet(id: string): FlowRecord {
  const found = readCollection<FlowRecord>(LOCAL_KEY).find((f) => f.id === id)
  if (!found) throw new Error(`Workflow ${id} not found`)
  return found
}

function localSave(input: SaveFlowInput): FlowRecord {
  const all = readCollection<FlowRecord>(LOCAL_KEY)
  const ts = now()
  if (input.id) {
    const idx = all.findIndex((f) => f.id === input.id)
    if (idx >= 0) {
      const updated: FlowRecord = {
        ...all[idx],
        title: input.title,
        view_flow: input.view_flow,
        // undefined keeps the stored tags, like the backend's upsert.
        tags: input.tags === undefined ? all[idx].tags : normalizeTags(input.tags),
        preferences: input.preferences === undefined ? all[idx].preferences : normalizePreferences(input.preferences),
        updatedAt: ts,
      }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: FlowRecord = {
    id: input.id ?? createId('flow'),
    title: input.title,
    view_flow: input.view_flow,
    tags: normalizeTags(input.tags),
    preferences: normalizePreferences(input.preferences),
    createdAt: ts,
    updatedAt: ts,
  }
  all.push(record)
  writeCollection(LOCAL_KEY, all)
  return record
}

function localRemove(id: string): void {
  writeCollection(
    LOCAL_KEY,
    readCollection<FlowRecord>(LOCAL_KEY).filter((f) => f.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const flowsApi = {
  isRemote: apiEnabled,

  list(params?: PaginationParams): Promise<Page<FlowRecord>> {
    if (apiEnabled()) return list<FlowRecord>('/flow', params)
    return Promise.resolve(localList(params))
  },

  get(id: string): Promise<FlowRecord> {
    if (apiEnabled()) return http.get<FlowRecord>(`/flow/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  /**
   * Run the backend inflow compiler over a saved flow and return the lowered
   * node graph — a debug/introspection view of what the Vue Flow canvas becomes
   * on the engine. Backend-only: compilation lives in the Go engine layer, so
   * there is nothing to return in local (no-backend) mode.
   */
  compile(id: string): Promise<CompiledFlow> {
    if (!apiEnabled()) return Promise.reject(new Error('Compiling a flow requires a connected backend'))
    return http.get<CompiledFlow>(`/flow/id/${id}/compile`)
  },

  save(input: SaveFlowInput): Promise<FlowRecord> {
    if (apiEnabled()) return http.post<FlowRecord>('/flow', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/flow/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },

  /**
   * The flow's preferences — its entry form — read and written on their own
   * (`GET/PUT /flow/id/:id/preferences`).
   *
   * Their own route for the same reason the tags have one: a form is edited by
   * a dialog that has no business re-sending (and possibly stale-overwriting) a
   * 35 KB view_flow to change a schema.
   */
  getPreferences(id: string): Promise<FlowPreferences> {
    if (apiEnabled()) {
      return http
        .get<{ id: string; preferences: FlowPreferences }>(`/flow/id/${id}/preferences`)
        .then((r) => r.preferences ?? {})
    }
    return Promise.resolve(localGet(id).preferences ?? {})
  },

  /** Set (or, with `{}`, clear) a flow's preferences without touching its graph. */
  setPreferences(id: string, preferences: FlowPreferences): Promise<FlowPreferences> {
    if (apiEnabled()) {
      return http
        .put<{ id: string; preferences: FlowPreferences }>(`/flow/id/${id}/preferences`, { preferences })
        .then((r) => r.preferences ?? {})
    }
    const rec = localGet(id)
    const saved = localSave({ id, title: rec.title, view_flow: rec.view_flow, preferences })
    return Promise.resolve(saved.preferences ?? {})
  },

  /**
   * The entry form resolved for one launch (`GET /flow/id/:id/entry`): the
   * declared form, the context path its answers land at, and the values the
   * fields should start at.
   *
   * The backend resolves it because "what should the fields start at" depends
   * on the entry's prefill mode and on the context the run will go against —
   * the launcher, an agent over MCP and an installer must all get the same
   * answer. Local mode resolves what it can itself (see resolveEntryViewLocally).
   */
  getEntry(id: string, contextId?: string): Promise<FlowEntryView> {
    if (apiEnabled()) {
      const q = contextId ? `?contextId=${encodeURIComponent(contextId)}` : ''
      return http.get<FlowEntryView>(`/flow/id/${id}/entry${q}`)
    }
    return Promise.resolve(resolveEntryViewLocally(localGet(id).preferences?.entry))
  },

  /**
   * Relabel a saved flow without resending its graph (`PUT /flow/id/:id/tags`).
   * `mode: 'merge'` adds to what the flow already carries; the default replaces
   * the list, and an empty list clears it.
   */
  setTags(id: string, tags: string[], mode: 'set' | 'merge' = 'set'): Promise<{ id: string; tags: string[] }> {
    if (apiEnabled()) return http.put<{ id: string; tags: string[] }>(`/flow/id/${id}/tags`, { tags, mode })
    const rec = localGet(id)
    const next = mode === 'merge' ? [...(rec.tags ?? []), ...tags] : tags
    const saved = localSave({ id, title: rec.title, view_flow: rec.view_flow, tags: next })
    return Promise.resolve({ id, tags: saved.tags ?? [] })
  },
}

/**
 * The backend's models.FlowPreferences.Normalize, for the local (no-backend)
 * path: an entry that describes no fields is no entry at all, so clearing the
 * schema in the editor and sending no entry leave the same stored state.
 */
function normalizePreferences(prefs?: FlowPreferences): FlowPreferences | undefined {
  const schema = prefs?.entry?.form?.schema
  if (!schema || !Object.keys(schema).length) return undefined
  return prefs
}

/**
 * The backend's models.NormalizeTags, for the local (no-backend) path and for
 * the tag inputs: trimmed, lower-cased, inner whitespace to a dash, commas and
 * quotes dropped (they would break the delimited filter), de-duplicated.
 * Exported so a tag editor shows the operator the tag they will actually get.
 */
export function normalizeTags(tags?: string[]): string[] {
  const out: string[] = []
  for (const raw of tags ?? []) {
    const t = raw
      .toLowerCase()
      .replace(/[,"]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
    if (t && !out.includes(t)) out.push(t)
    if (out.length === 32) break
  }
  return out
}
