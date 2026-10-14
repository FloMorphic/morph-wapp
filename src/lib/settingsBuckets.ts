import { NODE_LIST, specForType } from '@/data/nodeCatalog'
import { fetchPluginRegistrations } from '@/lib/nodeExtRefs'
import { nodeUniqLabel } from '@/lib/nodeSettings'
import { settingsSchemaFor } from '@/lib/settingsSchemas'
import { pluginColor } from '@/lib/pluginColor'

/**
 * The buckets a settings profile can be filed under — one per *node kind or
 * plugin identity* (`nodeUniqId`), which is what a profile is keyed by (see
 * {@link nodeUniqId} in lib/nodeSettings).
 *
 * There are two sources and they are both needed: the catalog's plugin-backed
 * builtins (llm / mcp / cast) and the imported plugins, which only the extension
 * registry knows about. The Node Settings page shows every bucket as a filter —
 * including the ones holding nothing yet, because "this plugin has no profile"
 * is exactly what a user comes to that page to find out — and the new-profile
 * dialog offers the same list as the places a profile may be filed.
 */
export interface SettingsBucket {
  /** The identity profiles are filed under: a morphic type, or `ext:<pluginId>`. */
  nodeUniqId: string
  /** Human name — the node's catalog label, or the plugin's registered name. */
  label: string
  /** The node kind stamped on a profile created here (`plugin` for a plugin). */
  nodeType: string
  icon: string
  /** The bucket's accent: the catalog color, or the plugin's hashed spectrum. */
  color: string
  /** The inflowv1 PLUGIN_ID, or '' for a builtin bucket. */
  pluginId: string
}

/**
 * The builtin nodes that take a profile — the ones whose drawer shows the
 * picker: every plugin-lowered kind, plus the ones that own a typed settings
 * schema. The second half is not redundant: HITL is not plugin-lowered, but its
 * conversation bot reads an LLM provider profile at run time (see
 * NodeSettingDetails.showSettingsProfile), so it is a bucket like any other.
 *
 * The generic `plugin` spec is excluded: it is the shell every imported action
 * shares, not a bucket of its own — an imported plugin's profiles live under its
 * own `ext:` id.
 */
export function builtinSettingsBuckets(): SettingsBucket[] {
  return NODE_LIST.filter((s) => (s.plugin || settingsSchemaFor(s.type)) && s.type !== 'plugin').map((s) => ({
    nodeUniqId: s.type,
    label: s.label,
    nodeType: s.type,
    icon: s.icon,
    color: s.color,
    pluginId: '',
  }))
}

/** Every bucket that currently exists: the builtins plus each imported plugin. */
export async function settingsBuckets(): Promise<SettingsBucket[]> {
  const plugins = (await fetchPluginRegistrations()).map((p) => ({
    nodeUniqId: `ext:${p.pluginId}`,
    label: p.name || p.pluginId,
    nodeType: 'plugin',
    icon: p.icon || 'plugin',
    color: pluginColor(p.pluginId),
    pluginId: p.pluginId,
  }))
  return [...builtinSettingsBuckets(), ...plugins]
}

/**
 * A bucket for an id that holds profiles but has no registration behind it — a
 * plugin that was removed, or one imported on another install. Its profiles are
 * still real and still editable, so the page lists them under the id itself
 * rather than dropping them off the end of the world.
 */
export function orphanSettingsBucket(nodeUniqId: string): SettingsBucket {
  const pluginId = nodeUniqId.startsWith('ext:') ? nodeUniqId.slice(4) : ''
  const spec = pluginId ? undefined : specForType(nodeUniqId)
  return {
    nodeUniqId,
    label: nodeUniqLabel(nodeUniqId),
    nodeType: pluginId ? 'plugin' : nodeUniqId,
    icon: pluginId ? 'plugin' : spec?.icon ?? 'settings',
    color: pluginId ? pluginColor(pluginId) : spec?.color ?? 'var(--accent)',
    pluginId,
  }
}
