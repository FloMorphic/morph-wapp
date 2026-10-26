import type {
  CompiledFlow,
  ExtensionKind,
  ExtensionType,
  FlowEntryView,
  FlowPlugin,
  FlowPreferences,
  FlowRecord,
  FlowSummary,
  Page,
  PaginationParams,
  SavedFlow,
  VueFlowGraph,
} from '@/types/api'
import { apiEnabled, http, list } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { resolveEntryViewLocally } from '@/lib/flowEntry'
import { namespaceOf } from '@/lib/exportFlow'
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

function localList(params?: PaginationParams): Page<FlowSummary> {
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
  const list = filtered.slice(start, start + perPage).map(summarize)
  return {
    list,
    total: filtered.length,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(filtered.length / perPage)),
  }
}

/** The list row of a stored record — the backend's FlowSummary, derived here so
 *  local mode answers the same shape (graph out, node count in). */
function summarize(f: FlowRecord): FlowSummary {
  return {
    id: f.id,
    title: f.title,
    tags: f.tags,
    preferences: f.preferences,
    plugins: collectFlowPlugins(f.view_flow),
    nodeCount: f.view_flow?.nodes?.length ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

function localGet(id: string): FlowRecord {
  const found = readCollection<FlowRecord>(LOCAL_KEY).find((f) => f.id === id)
  if (!found) throw new Error(`Workflow ${id} not found`)
  // Derived on the way out, like the backend recomputes it on the way in — a
  // record written before the field existed still answers the current shape.
  return { ...found, plugins: collectFlowPlugins(found.view_flow) }
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
        // Derived from the graph being saved, never from the input, exactly as
        // the backend's save does (see models.CollectFlowPlugins).
        plugins: collectFlowPlugins(input.view_flow),
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
    plugins: collectFlowPlugins(input.view_flow),
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

  /**
   * The flow list. A row is a {@link FlowSummary} — no graph: `view_flow` is
   * tens of kilobytes per flow and nothing in a list renders it, so it is
   * neither read nor sent per row (the node count comes along instead). Need a
   * listed flow's graph — to clone it, to read its nodes — and {@link get} it.
   */
  list(params?: PaginationParams): Promise<Page<FlowSummary>> {
    if (apiEnabled()) return list<FlowSummary>('/flow', params)
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
   *
   * `validate` adds the graph check to the answer (`validation`) without saving
   * anything — the "check this flow now" action, for a design the author has not
   * just saved. It never changes the status: a flow with findings still compiles
   * and still runs, so this resolves normally and the issues are in the payload.
   */
  compile(id: string, opts?: { validate?: boolean }): Promise<CompiledFlow> {
    if (!apiEnabled()) return Promise.reject(new Error('Compiling a flow requires a connected backend'))
    const q = opts?.validate ? '?validate=true' : ''
    return http.get<CompiledFlow>(`/flow/id/${id}/compile${q}`)
  },

  /**
   * Save a flow. The backend compiles the saved graph on the way out and returns
   * its findings as `validation` — advice for the author, never a refusal (the
   * record in the response is already saved). Local mode has no compiler, so it
   * answers the record alone.
   */
  save(input: SaveFlowInput): Promise<SavedFlow> {
    if (apiEnabled()) return http.post<SavedFlow>('/flow', input)
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
 * The plugin-backed node types and the identity each reports, mirroring the
 * backend's models.PluginBackedNodeType: the node kinds the compiler lowers to
 * an inflow Plugin node. The rest of the palette — a JS node, a rule, a HITL, a
 * store node — is run by the backend or the engine, so none of it belongs in a
 * flow's plugin list even though some of those nodes do reach outside.
 */
const PLUGIN_BACKED_TYPES: Record<string, { type: ExtensionType; kind: ExtensionKind }> = {
  plugin: { type: 'plugin', kind: 'extension' },
  llm: { type: 'llm', kind: 'builtin' },
  mcp: { type: 'mcp', kind: 'builtin' },
  cast: { type: 'cast', kind: 'builtin' },
  http: { type: 'http', kind: 'builtin' },
  'ai-decision': { type: 'ai-decision', kind: 'builtin' },
  // The decision node's former name. One plugin, so one entry: a flow mixing
  // nodes saved under both names must not list it twice.
  jev: { type: 'ai-decision', kind: 'builtin' },
}

/**
 * The backend's models.CollectFlowPlugins, for the local (no-backend) path: one
 * {@link FlowPlugin} per plugin behind the graph's wired-up plugin-backed nodes.
 *
 * Only a node with at least one edge on it is counted — a plugin node sitting
 * unwired on the canvas is one an author is still placing, so nothing about the
 * flow depends on the plugin behind it. Sorted the same way the backend sorts
 * (builtins first, then type, plugin id, actions) so a client diffing the list
 * across the two paths sees no churn.
 */
function collectFlowPlugins(graph: VueFlowGraph | undefined): FlowPlugin[] | undefined {
  const connected = new Set<string>()
  for (const e of graph?.edges ?? []) {
    if (e.source) connected.add(e.source)
    if (e.target) connected.add(e.target)
  }

  const groups = new Map<string, { entry: FlowPlugin; actions: Set<string> }>()
  for (const n of graph?.nodes ?? []) {
    const backing = PLUGIN_BACKED_TYPES[String(n.type ?? '').trim()]
    if (!backing || !connected.has(n.id)) continue
    const data = n.data as Record<string, unknown> | undefined
    const pluginId = String(data?.pluginId ?? '').trim()
    const action = String(data?.action ?? '').trim()

    // Keyed by the plugin, not the node: a builtin by its type (one builtin
    // kind is one plugin on an install, which keeps a legacy node carrying no
    // stamped pluginId in the same entry as a freshly dropped one), an imported
    // plugin by its id, falling back to the action's namespace while nothing
    // binds it — `jira.add_task` and `jira.update_task` on an uninstalled
    // plugin are one plugin to install, not two.
    let key = `builtin:${backing.type}`
    if (backing.kind === 'extension') {
      if (pluginId) key = `plugin:${pluginId}`
      else if (action) key = `action:${namespaceOf(action)}`
      // Neither bound nor named: nothing says which plugin the node means, and
      // it cannot compile either.
      else continue
    }

    let g = groups.get(key)
    if (!g) {
      g = { entry: { kind: backing.kind, type: backing.type, nodeCount: 0 }, actions: new Set<string>() }
      if (pluginId) g.entry.pluginId = pluginId
      groups.set(key, g)
    }
    g.entry.nodeCount++
    // A builtin's action is its type (`run`, `call_tool`, … are the node's own
    // request field, not a plugin the operator picks), so only an imported
    // plugin's methods are listed.
    if (backing.kind === 'extension' && action) g.actions.add(action)
    // One stamped node is enough to bind the group: a graph can hold a node
    // that was never stamped (hand-authored, or imported while the plugin was
    // missing) next to one that was.
    if (!g.entry.pluginId && pluginId) g.entry.pluginId = pluginId
  }
  if (!groups.size) return undefined

  const out = [...groups.values()].map(({ entry, actions }) =>
    actions.size ? { ...entry, actions: [...actions].sort() } : entry,
  )
  out.sort((a, b) => {
    const builtinA = a.kind === 'builtin'
    const builtinB = b.kind === 'builtin'
    if (builtinA !== builtinB) return builtinA ? -1 : 1
    return (
      a.type.localeCompare(b.type) ||
      (a.pluginId ?? '').localeCompare(b.pluginId ?? '') ||
      (a.actions ?? []).join(',').localeCompare((b.actions ?? []).join(','))
    )
  })
  return out
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
