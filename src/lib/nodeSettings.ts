import { specForType } from '@/data/nodeCatalog'

/**
 * The identity a settings profile binds to. A profile is reusable across every
 * instance of the same node, so it is keyed by the node's *kind / plugin
 * identity* — not the canvas instance id. Plugin nodes bound to a specific
 * extension get their own bucket (so two different plugins don't share
 * profiles); every other node kind shares one bucket per kind (all `llm` nodes
 * share LLM profiles, etc.).
 */
export function nodeUniqId(type: string, data?: Record<string, unknown>): string {
  const ext = data?.extensionId
  if (typeof ext === 'string' && ext.trim()) return `ext:${ext.trim()}`
  return type
}

/** Human label for a node's settings bucket, for the overview page grouping. */
export function nodeUniqLabel(nodeUniqId: string): string {
  if (nodeUniqId.startsWith('ext:')) return `Plugin · ${nodeUniqId.slice(4)}`
  return specForType(nodeUniqId)?.label ?? nodeUniqId
}

/** These node `data` keys are managed by the settings selector, not editable
 * as generic fields in the inspector. */
export const SETTINGS_DATA_KEYS = ['settingsId', 'settingsName'] as const
