import { specForType } from '@/data/nodeCatalog'

/**
 * The identity of the extension-table row backing a canvas node, stamped onto
 * the node's `data` when it is dropped from the palette. `extensionId` is the DB
 * row id (used by the backend compiler as the plugin node's uniqId — it must
 * match the row exactly); `pluginId` is the inflowv1 PLUGIN_ID, set only for user
 * `extension` nodes (empty for builtins).
 */
export interface NodeExtRef {
  extensionId: string
  pluginId?: string
}

/**
 * The identity a settings profile binds to. A profile is reusable across every
 * instance of the same node, so it is keyed by the node's *kind / plugin
 * identity* — not the canvas instance id, and not the (environment-specific)
 * extension row id. A node bound to a specific inflowv1 plugin gets its own
 * bucket keyed by `pluginId`; every builtin shares one bucket per morphic type
 * (all `llm` nodes share LLM profiles, etc.).
 */
export function nodeUniqId(type: string, data?: Record<string, unknown>): string {
  const plugin = data?.pluginId
  if (typeof plugin === 'string' && plugin.trim()) return `ext:${plugin.trim()}`
  return type
}

/**
 * Whether a node uses a settings profile. Only Plugin nodes take their runtime
 * config from a profile: the builtins flagged `plugin` in the catalog
 * (llm / mcp / cast) and any user-dropped inflowv1 plugin node (carries a
 * `pluginId`). Every other kind is configured by its own fields, so the drawer
 * hides the profile picker for them.
 */
export function usesSettingsProfile(type: string, data?: Record<string, unknown>): boolean {
  const plugin = data?.pluginId
  if (typeof plugin === 'string' && plugin.trim()) return true
  return specForType(type)?.plugin === true
}

/** Human label for a node's settings bucket, for the overview page grouping. */
export function nodeUniqLabel(nodeUniqId: string): string {
  if (nodeUniqId.startsWith('ext:')) return `Plugin · ${nodeUniqId.slice(4)}`
  return specForType(nodeUniqId)?.label ?? nodeUniqId
}

/** These node `data` keys are managed by the settings selector, not editable
 * as generic fields in the inspector. */
export const SETTINGS_DATA_KEYS = ['settingsId', 'settingsName'] as const

/** Node-identity keys stamped from the palette's backing extension row. They are
 * system-managed (see {@link NodeExtRef}), not user-editable generic fields. */
export const NODE_REF_DATA_KEYS = ['extensionId', 'pluginId'] as const
