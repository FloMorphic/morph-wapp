import type { CompiledFlow, FlowRecord, Page, PaginationParams, VueFlowGraph } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
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
