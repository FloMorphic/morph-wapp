import type { NodeSetting, Page, PaginationParams } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Node settings-profile repository. A profile is a reusable, named key/value
 * config bound to a node (its kind / plugin identity, `nodeUniqId`). Uses the
 * morph-api `/settings` endpoints when a backend is configured, otherwise
 * persists to localStorage so the app works standalone. Both paths return
 * identical {@link NodeSetting} shapes.
 */

const LOCAL_KEY = 'node_settings'

export interface NodeSettingsListParams extends PaginationParams {
  /** Scope the list to one node's profiles (its kind / plugin identity). */
  node?: string
}

export interface SaveNodeSettingInput {
  id?: string
  nodeUniqId: string
  /** The node's kind, set by the frontend (not the user). */
  nodeType?: string
  title: string
  settings: Record<string, unknown>
}

// ---- Local backend ----------------------------------------------------------

function localAll(): NodeSetting[] {
  return readCollection<NodeSetting>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

function localList(params?: NodeSettingsListParams): Page<NodeSetting> {
  let all = localAll()
  const search = params?.search?.toLowerCase()
  if (search) all = all.filter((s) => s.title.toLowerCase().includes(search))
  if (params?.node) all = all.filter((s) => s.nodeUniqId === params.node)
  const perPage = params?.per_page ?? 12
  const page = Math.max(1, params?.page ?? 1)
  const start = (page - 1) * perPage
  return {
    list: all.slice(start, start + perPage),
    total: all.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(all.length / perPage)),
  }
}

function localGet(id: string): NodeSetting {
  const found = localAll().find((s) => s.id === id)
  if (!found) throw new Error(`Settings profile ${id} not found`)
  return found
}

function localSave(input: SaveNodeSettingInput): NodeSetting {
  const all = readCollection<NodeSetting>(LOCAL_KEY)
  const ts = now()
  if (input.id) {
    const idx = all.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      const updated: NodeSetting = {
        ...all[idx],
        nodeUniqId: input.nodeUniqId,
        nodeType: input.nodeType ?? all[idx].nodeType ?? '',
        title: input.title,
        settings: input.settings ?? {},
        updatedAt: ts,
      }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: NodeSetting = {
    id: input.id ?? createId('nset'),
    nodeUniqId: input.nodeUniqId,
    nodeType: input.nodeType ?? '',
    title: input.title,
    settings: input.settings ?? {},
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
    readCollection<NodeSetting>(LOCAL_KEY).filter((s) => s.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const nodeSettingsApi = {
  isRemote: apiEnabled,

  list(params?: NodeSettingsListParams): Promise<Page<NodeSetting>> {
    if (apiEnabled()) return list<NodeSetting>('/settings', params as Record<string, unknown>)
    return Promise.resolve(localList(params))
  },

  /** Convenience: every profile bound to one node (its kind / plugin identity). */
  async listForNode(nodeUniqId: string): Promise<NodeSetting[]> {
    const page = await this.list({ node: nodeUniqId, per_page: 100 })
    return page.list
  },

  get(id: string): Promise<NodeSetting> {
    if (apiEnabled()) return http.get<NodeSetting>(`/settings/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  save(input: SaveNodeSettingInput): Promise<NodeSetting> {
    if (apiEnabled()) return http.post<NodeSetting>('/settings', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/settings/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },
}
