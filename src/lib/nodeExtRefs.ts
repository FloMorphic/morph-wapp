/**
 * Extension-row identity per morphic node type, cached for the session.
 *
 * A canvas node is stamped with the {@link NodeExtRef} of the `/extension` row
 * backing it, so the backend compiler can register a plugin node under the exact
 * id the extension table holds (see lib/nodeSettings). The palette needs that
 * map to attach it to a drag; the AI importer needs the same map to stamp nodes
 * it adds without a drag. Both read it from here so a node added either way is
 * identical.
 *
 * Deliberately not a Pinia store: the node-registry store is page state (the
 * Settings admin panel refreshes and rescopes it), while this is a read-only
 * lookup that must not change under the canvas. Fetched once per session, and
 * fails soft to `null` — no backend, or nothing seeded yet, means no identity to
 * stamp, exactly as the palette already behaves standalone.
 */

import { nodeRegistryApi } from '@/api/nodeRegistry'
import { specForType } from '@/data/nodeCatalog'
import type { NodeExtRef } from '@/lib/nodeSettings'

export type NodeExtRefMap = Record<string, NodeExtRef>

let cache: Promise<NodeExtRefMap | null> | null = null

/** The map keyed by morphic type, or null when the registry has nothing to say. */
export function fetchNodeExtRefs(force = false): Promise<NodeExtRefMap | null> {
  if (!force && cache) return cache
  cache = load().catch(() => null)
  return cache
}

async function load(): Promise<NodeExtRefMap | null> {
  const page = await nodeRegistryApi.list({ kind: 'builtin', per_page: 100 })
  const map: NodeExtRefMap = {}
  for (const row of page.list) {
    if (specForType(row.type)) map[row.type] = { extensionId: row.id, pluginId: row.pluginId || undefined }
  }
  return Object.keys(map).length ? map : null
}

/**
 * One palette entry contributed by an imported plugin — a single action of it.
 *
 * These exist because a plugin was synced (Extensions → refresh), which writes
 * one extension row per live action. They are grouped by the plugin they came
 * from so the palette can show "Jira · Add task" rather than a flat list of
 * methods from unrelated plugins.
 */
export interface PluginActionEntry {
  /** What gets stamped on the node when this entry is dragged. */
  ref: NodeExtRef
  action: string
  label: string
  description: string
  icon: string
  /** The plugin this action belongs to, for grouping and search. */
  pluginId: string
  pluginName: string
}

/**
 * An imported plugin's own registration row, keyed by the inflowv1 plugin id.
 *
 * The live `@`-descriptor fetches are addressed by *extension row id*, while
 * everything downstream of the palette only carries the `pluginId` (it is what a
 * node is stamped with and what a settings profile is filed under). This is the
 * lookup between the two, so a dialog holding nothing but a plugin id can still
 * ask that plugin what it needs.
 */
export interface PluginRegistration {
  extensionId: string
  pluginId: string
  name: string
}

let registrationCache: Promise<PluginRegistration[]> | null = null

/** Every imported plugin, without its synced action rows. Empty when nothing is
 *  imported or there is no backend — both mean "no plugin to ask". */
export function fetchPluginRegistrations(force = false): Promise<PluginRegistration[]> {
  if (!force && registrationCache) return registrationCache
  registrationCache = loadRegistrations().catch(() => [])
  return registrationCache
}

/** Drop the cached list — the Extensions portal calls this after registering or
 *  removing a plugin, so the next dialog opened sees the current set. */
export function invalidatePluginRegistrations(): void {
  registrationCache = null
}

/** The registration behind one plugin id, or null when nothing is imported under it. */
export async function pluginRegistration(pluginId: string): Promise<PluginRegistration | null> {
  if (!pluginId) return null
  return (await fetchPluginRegistrations()).find((p) => p.pluginId === pluginId) ?? null
}

async function loadRegistrations(): Promise<PluginRegistration[]> {
  const page = await nodeRegistryApi.list({ kind: 'extension', per_page: 200 })
  return page.list
    .filter((row) => !row.action && row.pluginId)
    .map((row) => ({ extensionId: row.id, pluginId: row.pluginId, name: row.name }))
}

let actionCache: Promise<PluginActionEntry[]> | null = null

/**
 * The plugin-contributed palette entries. Empty when nothing is imported, no
 * plugin has been synced yet, or there is no backend — in every case the palette
 * simply has no Plugins section to show.
 *
 * Cached like the builtin map, and invalidated with `force` after a sync so the
 * palette reflects a plugin's new action list without a page reload.
 */
export function fetchPluginActions(force = false): Promise<PluginActionEntry[]> {
  if (!force && actionCache) return actionCache
  actionCache = loadActions().catch(() => [])
  return actionCache
}

async function loadActions(): Promise<PluginActionEntry[]> {
  const page = await nodeRegistryApi.list({ kind: 'extension', per_page: 200 })
  // A row with an `action` is one method of a plugin; the rest are the plugins'
  // own registration rows, which name them.
  const pluginNames = new Map<string, string>()
  for (const row of page.list) {
    if (!row.action && row.pluginId) pluginNames.set(row.pluginId, row.name)
  }
  return page.list
    .filter((row) => row.action && row.pluginId)
    .map((row) => ({
      ref: {
        extensionId: row.id,
        pluginId: row.pluginId,
        action: row.action,
        label: row.name,
        form: { schema: row.params?.schema ?? {}, ui: row.params?.ui ?? {} },
        outbound: row.outbound ?? [],
      },
      action: row.action as string,
      label: row.name,
      description: row.description,
      icon: row.icon?.name || 'plugin',
      pluginId: row.pluginId,
      pluginName: pluginNames.get(row.pluginId) ?? row.pluginId,
    }))
}
