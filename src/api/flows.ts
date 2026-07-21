import type { CompiledFlow, FlowRecord, Page, PaginationParams, VueFlowGraph } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Flow repository. Uses the inspector-api `/flow` endpoints when a backend is
 * configured, otherwise persists to localStorage so the app works standalone.
 * Both paths return identical {@link FlowRecord} shapes.
 */

const LOCAL_KEY = 'flows'

export interface SaveFlowInput {
  id?: string
  title: string
  view_flow: VueFlowGraph
}

// ---- Local backend ----------------------------------------------------------

function localList(params?: PaginationParams): Page<FlowRecord> {
  const all = readCollection<FlowRecord>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
  const search = params?.search?.toLowerCase()
  const filtered = search ? all.filter((f) => f.title.toLowerCase().includes(search)) : all
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
      const updated: FlowRecord = { ...all[idx], title: input.title, view_flow: input.view_flow, updatedAt: ts }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: FlowRecord = {
    id: input.id ?? createId('flow'),
    title: input.title,
    view_flow: input.view_flow,
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
}
