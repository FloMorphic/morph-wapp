import type {
  ExtensionKind,
  ExtensionRecord,
  ExtensionType,
  InstallInfo,
  McpConnection,
  McpTool,
  Page,
  PaginationParams,
  PluginCredRequest,
  PluginCredResponse,
  PluginAction,
  PluginEnvResponse,
  PluginFormBuilder,
  PluginIntro,
  SyncResult,
} from '@/types/api'
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
 * via `pluginId`). Rows of the second kind also carry an `install` spec, which
 * the install endpoints below turn into the script / env a user runs to get
 * that plugin up (see the Extensions portal store).
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
  install?: ExtensionRecord['install']
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
  // Mirror the backend's rule locally: an extension's plugin id is issued once
  // (a UUID — it is an inflow address, not a label) and then never reassigned.
  const pluginId =
    input.kind === 'extension'
      ? base?.pluginId || input.pluginId || crypto.randomUUID()
      : input.pluginId ?? base?.pluginId ?? ''
  return {
    kind: input.kind,
    type: input.type,
    name: input.name,
    description: input.description ?? base?.description ?? '',
    pluginId,
    icon: input.icon ?? base?.icon ?? { class: '', name: '', meta: {} },
    params: input.params ?? base?.params ?? { schema: {}, ui: {} },
    bindTo: input.bindTo ?? base?.bindTo ?? { topic_key: '', values: {} },
    install: input.install ?? base?.install,
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

  /** Mint a runtime credential for a plugin-backed node so its inflowv1 plugin
   * can be run to serve the node's functionality. Used by the "get credential"
   * button on plugin nodes (builtin llm/mcp/cast carry a hard-coded pluginId
   * from the seed; user extension nodes carry their imported pluginId).
   * Requires a backend + the plugin runtime. */
  pluginCred: (req: PluginCredRequest) =>
    http.post<PluginCredResponse>('/extension/plugin/cred', req),

  // ---- Getting an imported plugin running ---------------------------------
  // Two onboarding paths for the Extensions portal, both answered by the
  // backend with a freshly minted, plugin-scoped credential baked in.

  /** Everything needed to install this row's plugin from source: a one-liner to
   * paste into a shell, the installer it pipes into bash, and the env that
   * installer writes. `dir` picks the install directory. 400s for a row with no
   * `install.repo` — that plugin is an "env only" one. */
  installInfo: (id: string, dir?: string) =>
    http.get<InstallInfo>(`/extension/id/${id}/install`, dir ? { dir } : undefined),

  /** Just the dotenv, for a user who already has the plugin checked out: the
   * three SDK variables plus whatever extras the row declared. */
  pluginEnv: (id: string) => http.get<PluginEnvResponse>(`/extension/id/${id}/env`),

  /** Re-read a running plugin's `@intro` + `@actions` and rebuild its palette
   * rows from them — one node per live action, replacing the previous set so a
   * method the plugin dropped leaves the palette with it. Needs the plugin to
   * be up; a plugin that doesn't answer is an error rather than an empty sync,
   * so a process being down never wipes the palette. */
  sync: (id: string) => http.post<SyncResult>(`/extension/id/${id}/sync`),

  // ---- Live inflowv1 fetches (extension nodes only) -----------------------
  // These proxy the connected plugin over NATS on the backend; they only work
  // with a backend + a running plugin.
  /** `@intro`: the plugin's identity plus the settings form it wants filled in
   * before any action runs. Best-effort — the Go SDK through v0.1.3 never
   * answers it (its handler marshals the `Intro` method instead of the intro
   * field), so callers must have a fallback rather than treat silence as down. */
  intro: (id: string) => http.get<PluginIntro>(`/extension/id/${id}/intro`),

  /** `@settings`: the plugin's settings form on its own. The fallback source for
   * onboarding when `@intro` carries nothing — a plugin that declared its
   * requirements through the SDK's `RequiredParams` serves them here. */
  settings: (id: string) => http.get<PluginFormBuilder>(`/extension/id/${id}/settings`),

  /** `@actions`: the methods the plugin exposes. Also the liveness probe — it is
   * the one descriptor every SDK version answers, so a plugin that replies here
   * is genuinely up. */
  actions: (id: string) => http.get<PluginAction[]>(`/extension/id/${id}/actions`),
  actionForm: (id: string, method: string) => http.get<unknown>(`/extension/id/${id}/actions/${method}/form`),

  /** Live: connect to the MCP server configured on an MCP node and list its
   * tools, so each can be bound as a function (the MCP-with-LLM "load tools"
   * button). Calls the MCP plugin's `getToolsList` method over inflowv1 via the
   * backend REST->inflowv1 shim — the POST body carries the connection params,
   * which the reserved `@`-descriptor fetches above don't. `pluginId` is the MCP
   * node's inflowv1 plugin id (`data.pluginId`, the hard-coded seed id); the
   * proxy keys the plugin directly by it, no extension row involved. Needs a
   * backend + the MCP plugin running. */
  mcpTools: (pluginId: string, connection: McpConnection) =>
    http.post<McpTool[]>(`/extension/id/${pluginId}/getToolsList`, connection),
}
