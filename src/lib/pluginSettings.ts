import { nodeRegistryApi } from '@/api/nodeRegistry'
import type { PluginIntro } from '@/types/api'

/**
 * Reading the settings form a plugin wants filled in before any of its actions
 * run — the one thing a settings profile for that plugin should ever be built
 * from.
 *
 * Two descriptors serve the same document and both have to be tried: `@intro`
 * carries the form alongside the plugin's identity, `@settings` serves it on its
 * own. A plugin may declare its requirements through either, and the Go SDK
 * through v0.1.3 answers `@intro` with the wrong payload — so asking only there
 * would make a demonstrably running plugin look like it needs nothing.
 *
 * Every fetch fails soft. A plugin is a third party: unreachable, or answering
 * with something unusable, is a normal state that must degrade to "no form"
 * rather than break the dialog around it.
 */
export async function fetchPluginIntro(extensionId: string): Promise<PluginIntro> {
  const intro = await nodeRegistryApi.intro(extensionId).catch(() => null)
  if (intro?.settings?.jsonschema) return intro
  const settings = await nodeRegistryApi.settings(extensionId).catch(() => null)
  // An empty result is a real answer — this plugin asks for nothing — and is
  // returned as such, not as a failure.
  return { ...(intro ?? {}), settings: settings ?? undefined }
}
