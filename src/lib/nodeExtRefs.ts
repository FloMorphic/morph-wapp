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
