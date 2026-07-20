import type { ContextRecord, Page, PaginationParams } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Context repository. Uses the morph-api `/context` endpoints when a backend is
 * configured, otherwise persists to localStorage so the app works standalone.
 * Both paths return identical {@link ContextRecord} shapes.
 *
 * A context is a JSON document (`context`, serialized as a string) plus free-form
 * `header` metadata. A manual save through the app is attributed to `manual`.
 */

const LOCAL_KEY = 'contexts'

export interface SaveContextInput {
  id?: string
  title: string
  /** The context document — a JSON object serialized as a string. */
  context: string
  header?: Record<string, unknown>
}

// ---- Local backend ----------------------------------------------------------

function localList(params?: PaginationParams): Page<ContextRecord> {
  const all = readCollection<ContextRecord>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
  const search = params?.search?.toLowerCase()
  const filtered = search ? all.filter((c) => c.title.toLowerCase().includes(search)) : all
  const perPage = params?.per_page ?? 12
  const page = Math.max(1, params?.page ?? 1)
  const start = (page - 1) * perPage
  return {
    list: filtered.slice(start, start + perPage),
    total: filtered.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(filtered.length / perPage)),
  }
}

function localGet(id: string): ContextRecord {
  const found = readCollection<ContextRecord>(LOCAL_KEY).find((c) => c.id === id)
  if (!found) throw new Error(`Context ${id} not found`)
  return found
}

function localSave(input: SaveContextInput): ContextRecord {
  const all = readCollection<ContextRecord>(LOCAL_KEY)
  const ts = now()
  if (input.id) {
    const idx = all.findIndex((c) => c.id === input.id)
    if (idx >= 0) {
      const updated: ContextRecord = {
        ...all[idx],
        title: input.title,
        context: input.context,
        header: input.header ?? all[idx].header ?? {},
        updatedBy: { by: 'manual', address: '' },
        updatedAt: ts,
      }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: ContextRecord = {
    id: input.id ?? createId('ctx'),
    title: input.title,
    context: input.context,
    header: input.header ?? {},
    updatedBy: { by: 'manual', address: '' },
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
    readCollection<ContextRecord>(LOCAL_KEY).filter((c) => c.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const contextsApi = {
  isRemote: apiEnabled,

  list(params?: PaginationParams): Promise<Page<ContextRecord>> {
    if (apiEnabled()) return list<ContextRecord>('/context', params)
    return Promise.resolve(localList(params))
  },

  get(id: string): Promise<ContextRecord> {
    if (apiEnabled()) return http.get<ContextRecord>(`/context/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  save(input: SaveContextInput): Promise<ContextRecord> {
    if (apiEnabled()) return http.post<ContextRecord>('/context', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/context/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },
}
