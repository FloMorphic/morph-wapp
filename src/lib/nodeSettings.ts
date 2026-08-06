import { specForType } from '@/data/nodeCatalog'
import type { OutboundPort } from '@/types/api'

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
  /**
   * For a node contributed by an imported plugin: the action (inflowv1 method)
   * this palette entry calls, plus the label and form the plugin advertised for
   * it. Carried onto the node so it is self-contained — the drawer renders the
   * action's fields without asking the plugin again, which matters because a
   * plugin that is temporarily down would otherwise make its nodes uneditable.
   */
  action?: string
  label?: string
  form?: { schema: Record<string, unknown>; ui: Record<string, unknown> }
  /**
   * The action's optional declared branch ports (SDK Action.Outbound). Carried
   * onto the node so it renders one output port per entry the moment it lands,
   * with edges inheriting each port's route tags — no round trip to the plugin.
   * Absent means the node keeps its single default source handle.
   */
  outbound?: OutboundPort[]
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
 * as generic fields in the inspector. `settings` is the selected profile's
 * resolved values, denormalized onto the node so the backend compiler can ship
 * them as the plugin body's `settings` without reading the profile store. */
export const SETTINGS_DATA_KEYS = ['settingsId', 'settingsName', 'settings'] as const

/** Node-identity keys stamped from the palette's backing extension row. They are
 * system-managed (see {@link NodeExtRef}), not user-editable generic fields.
 * `action` and `form` join them for plugin-contributed nodes: the method to call
 * and the form that method advertised. */
export const NODE_REF_DATA_KEYS = ['extensionId', 'pluginId', 'action', 'form', 'outbound'] as const
