import type { Page, PaginationParams, PromptTemplate, PromptVariable } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Prompt-template repository. Uses the morph-api `/prompt` endpoints when a
 * backend is configured, otherwise persists to localStorage so the app works
 * standalone. Both paths return identical {@link PromptTemplate} shapes.
 */

const LOCAL_KEY = 'prompts'

export interface SavePromptInput {
  id?: string
  title: string
  description?: string
  template: string
  variables?: PromptVariable[]
  tags?: string[]
}

// ---- Local backend ----------------------------------------------------------

function localList(params?: PaginationParams): Page<PromptTemplate> {
  const all = readCollection<PromptTemplate>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
  const search = params?.search?.toLowerCase()
  const filtered = search
    ? all.filter((p) => p.title.toLowerCase().includes(search) || p.description.toLowerCase().includes(search))
    : all
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

function localGet(id: string): PromptTemplate {
  const found = readCollection<PromptTemplate>(LOCAL_KEY).find((p) => p.id === id)
  if (!found) throw new Error(`Prompt ${id} not found`)
  return found
}

function localSave(input: SavePromptInput): PromptTemplate {
  const all = readCollection<PromptTemplate>(LOCAL_KEY)
  const ts = now()
  if (input.id) {
    const idx = all.findIndex((p) => p.id === input.id)
    if (idx >= 0) {
      const updated: PromptTemplate = {
        ...all[idx],
        title: input.title,
        description: input.description ?? '',
        template: input.template,
        variables: input.variables ?? [],
        tags: input.tags ?? [],
        updatedAt: ts,
      }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: PromptTemplate = {
    id: input.id ?? createId('prompt'),
    title: input.title,
    description: input.description ?? '',
    template: input.template,
    variables: input.variables ?? [],
    tags: input.tags ?? [],
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
    readCollection<PromptTemplate>(LOCAL_KEY).filter((p) => p.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const promptsApi = {
  isRemote: apiEnabled,

  list(params?: PaginationParams): Promise<Page<PromptTemplate>> {
    if (apiEnabled()) return list<PromptTemplate>('/prompt', params)
    return Promise.resolve(localList(params))
  },

  get(id: string): Promise<PromptTemplate> {
    if (apiEnabled()) return http.get<PromptTemplate>(`/prompt/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  save(input: SavePromptInput): Promise<PromptTemplate> {
    if (apiEnabled()) return http.post<PromptTemplate>('/prompt', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/prompt/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },
}
