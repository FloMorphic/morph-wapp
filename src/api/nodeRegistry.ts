import type { ExtensionKind, ExtensionRecord, ExtensionType, Page, PaginationParams } from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Node registry repository — the canvas palette's node definitions, backed by
 * the morph-api `/extension` endpoints.
 *
 * A row is a palette node: an admin-managed **builtin** (seeded server-side on
 * first run, UI hard-coded in the front end) or a user-imported **extension**
 * (an inflowv1 plugin whose settings form + actions are fetched live over NATS
 * via `pluginId`). This is distinct from {@link ProjectExtension} (the
 * repo-clone flow in `./extensions.ts`).
 *
 * When a backend is configured the calls hit `/extension`; otherwise definitions
 * are kept in localStorage so the registry is usable standalone (builtins are
 * only seeded by a running backend, so the local list starts empty).
 */

const LOCAL_KEY = 'node_registry'

export interface RegistryListParams extends PaginationParams {
  /** Scope to one origin: 'builtin' (admin panel) or 'extension' (portal). */
  kind?: ExtensionKind
}

export interface SaveExtensionInput {
  id?: string
  kind: ExtensionKind
  type: ExtensionType
  name: string
  description?: string
  pluginId?: string
  icon?: ExtensionRecord['icon']
  params?: ExtensionRecord['params']
  bindTo?: ExtensionRecord['bindTo']
}

// ---- Local backend ----------------------------------------------------------

function localAll(): ExtensionRecord[] {
  return readCollection<ExtensionRecord>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

function localList(params?: RegistryListParams): Page<ExtensionRecord> {
  let all = localAll()
  const search = params?.search?.toLowerCase()
  if (search) all = all.filter((e) => e.name.toLowerCase().includes(search))
  if (params?.kind) all = all.filter((e) => e.kind === params.kind)
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

function localGet(id: string): ExtensionRecord {
  const found = localAll().find((e) => e.id === id)
  if (!found) throw new Error(`Extension ${id} not found`)
  return found
}

function normalize(input: SaveExtensionInput, base?: Partial<ExtensionRecord>): Omit<ExtensionRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    kind: input.kind,
    type: input.type,
    name: input.name,
    description: input.description ?? base?.description ?? '',
    pluginId: input.pluginId ?? base?.pluginId ?? '',
    icon: input.icon ?? base?.icon ?? { class: '', name: '', meta: {} },
    params: input.params ?? base?.params ?? { schema: {}, ui: {} },
    bindTo: input.bindTo ?? base?.bindTo ?? { topic_key: '', values: {} },
  }
}

function localSave(input: SaveExtensionInput): ExtensionRecord {
  const all = readCollection<ExtensionRecord>(LOCAL_KEY)
  const ts = now()
  if (input.id) {
    const idx = all.findIndex((e) => e.id === input.id)
    if (idx >= 0) {
      const updated: ExtensionRecord = { ...all[idx], ...normalize(input, all[idx]), updatedAt: ts }
      all[idx] = updated
      writeCollection(LOCAL_KEY, all)
      return updated
    }
  }
  const record: ExtensionRecord = {
    id: input.id ?? createId('ext'),
    ...normalize(input),
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
    readCollection<ExtensionRecord>(LOCAL_KEY).filter((e) => e.id !== id),
  )
}

// ---- Public API -------------------------------------------------------------

export const nodeRegistryApi = {
  isRemote: apiEnabled,

  list(params?: RegistryListParams): Promise<Page<ExtensionRecord>> {
    if (apiEnabled()) return list<ExtensionRecord>('/extension', params as Record<string, unknown>)
    return Promise.resolve(localList(params))
  },

  get(id: string): Promise<ExtensionRecord> {
    if (apiEnabled()) return http.get<ExtensionRecord>(`/extension/id/${id}`)
    return Promise.resolve(localGet(id))
  },

  save(input: SaveExtensionInput): Promise<ExtensionRecord> {
    if (apiEnabled()) return http.post<ExtensionRecord>('/extension', input)
    return Promise.resolve(localSave(input))
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/extension/id/${id}`)
    localRemove(id)
    return Promise.resolve()
  },

  /** Backend-registered extrinsic services (topicKey -> subject template) an
   * extrinsic node can bind to. Empty when standalone or the runtime is off. */
  extrinsics(): Promise<Record<string, string>> {
    if (apiEnabled()) return http.get<Record<string, string>>('/extension/extrinsics')
    return Promise.resolve({})
  },

  // ---- Live inflowv1 fetches (extension nodes only) -----------------------
  // These proxy the connected plugin over NATS on the backend; they only work
  // with a backend + a running plugin.
  intro: (id: string) => http.get<unknown>(`/extension/id/${id}/intro`),
  settings: (id: string) => http.get<unknown>(`/extension/id/${id}/settings`),
  actions: (id: string) => http.get<unknown>(`/extension/id/${id}/actions`),
  actionForm: (id: string, method: string) => http.get<unknown>(`/extension/id/${id}/actions/${method}/form`),
}
