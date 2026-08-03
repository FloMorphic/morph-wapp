import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ExtensionRecord,
  InstallInfo,
  InstallSpec,
  PluginEnvResponse,
  PluginIntro,
  SyncResult,
} from '@/types/api'
import { nodeRegistryApi, type SaveExtensionInput } from '@/api/nodeRegistry'
import { fetchPluginActions, invalidatePluginRegistrations } from '@/lib/nodeExtRefs'

/**
 * Extensions portal store — the user-imported half of the node registry
 * (`/extension?kind=extension`), i.e. third-party inflowv1 plugins.
 *
 * Registering one is only a database row: the plugin itself is a process the
 * user runs wherever they like, and all FloMorphic needs is for it to reach
 * inflow under the `pluginId` this row holds. So the portal's job is to hand
 * back what it takes to run it — an installer one-liner for a plugin that lives
 * in a git repo, or just the env file for one the user already has — and then to
 * show whether it actually came up.
 *
 * "Up" is not stored anywhere: it is asked live, by fetching the plugin's
 * `@intro` over NATS through the backend proxy. A plugin that answers is
 * running; anything else (no backend, runtime off, process not started) reads as
 * down, which is exactly what the user needs to see.
 */

/** Live reachability of one registered plugin. */
export type PluginStatus = 'unknown' | 'checking' | 'up' | 'down'

export interface PluginState {
  status: PluginStatus
  /** The plugin's own `@intro` when it answered — identity plus the settings
   *  form the portal turns into a settings profile. */
  intro?: PluginIntro
  /** Why the probe failed, for the card's tooltip. */
  error?: string
  /** How many palette nodes the last sync wrote. */
  actions?: number
}

export const useExtensionsStore = defineStore('extensions', () => {
  /** Every extension row: the plugins the user registered *and* the palette
   *  nodes synced from their actions. */
  const all = ref<ExtensionRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isRemote = nodeRegistryApi.isRemote()
  /** Probe result per extension row id. */
  const states = ref<Record<string, PluginState>>({})

  /** The registered plugins — what the portal lists. A row with an `action` is
   *  not a plugin but one of its methods, and belongs to the palette. */
  const items = computed(() => all.value.filter((e) => !e.action))

  /** The synced action rows of one plugin, in the order they were written. */
  function actionsOf(pluginId: string): ExtensionRecord[] {
    return all.value.filter((e) => e.action && e.pluginId === pluginId)
  }

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const page = await nodeRegistryApi.list({ kind: 'extension', per_page: 200 })
      all.value = page.list
      // Drop probe results for rows that are gone, keep the rest so a refresh
      // doesn't blank the status column.
      const live: Record<string, PluginState> = {}
      for (const row of items.value) live[row.id] = states.value[row.id] ?? { status: 'unknown' }
      states.value = live
    } catch (err) {
      error.value = (err as Error).message
      all.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Ask one plugin whether it is up, by fetching its `@actions` live.
   *
   * `@actions` rather than `@intro` because it is the descriptor every SDK
   * version actually answers — the Go SDK through v0.1.3 never replies to
   * `@intro` at all, so probing on that would report every healthy plugin as
   * down. It also tells us how many nodes the plugin currently offers, which is
   * what the card wants to show anyway.
   */
  async function probe(id: string): Promise<void> {
    if (!isRemote) {
      states.value = { ...states.value, [id]: { status: 'down', error: 'No backend configured.' } }
      return
    }
    const prev = states.value[id]
    states.value = { ...states.value, [id]: { ...prev, status: 'checking' } }
    try {
      const actions = await nodeRegistryApi.actions(id)
      states.value = {
        ...states.value,
        [id]: { ...prev, status: 'up', actions: Array.isArray(actions) ? actions.length : undefined, error: undefined },
      }
    } catch (err) {
      states.value = { ...states.value, [id]: { ...prev, status: 'down', error: (err as Error).message } }
    }
  }

  /** Probe every registered plugin — the list's "check all" pass. Runs in
   *  parallel; each probe already fails soft into its own row. */
  async function probeAll(): Promise<void> {
    await Promise.all(items.value.map((e) => probe(e.id)))
  }

  /** Register (or update) a plugin row. The generated `pluginId` is what the
   *  credential is scoped to and what inflow addresses the plugin by, so it is
   *  set once here and then never changes. */
  async function save(input: SaveExtensionInput): Promise<ExtensionRecord> {
    const saved = await nodeRegistryApi.save({ ...input, kind: 'extension' })
    // The pluginId → row lookup a settings dialog resolves its plugin through is
    // cached for the session, so a plugin registered now has to drop it.
    invalidatePluginRegistrations()
    await refresh()
    return saved
  }

  /** Remove a plugin. The backend takes its synced action rows with it, so the
   *  list is re-read rather than filtered locally. */
  async function remove(id: string): Promise<void> {
    await nodeRegistryApi.remove(id)
    invalidatePluginRegistrations()
    await refresh()
  }

  /** Re-read a plugin's live descriptors and rebuild its palette nodes from
   *  them. Also refreshes the row's probe state: a plugin that answered a sync
   *  is by definition up, and its `@intro` came back with the answer. */
  async function sync(id: string): Promise<SyncResult> {
    const result = await nodeRegistryApi.sync(id)
    states.value = {
      ...states.value,
      [id]: { status: 'up', intro: result.intro, actions: result.added },
    }
    await refresh()
    // The palette caches its plugin entries for the session, so a sync that
    // added or dropped an action has to invalidate them — otherwise the canvas
    // keeps offering the old action list until a page reload.
    await fetchPluginActions(true)
    return result
  }

  /** The install one-liner + script + env for a row with a source repo. */
  function installInfo(id: string, dir?: string): Promise<InstallInfo> {
    return nodeRegistryApi.installInfo(id, dir)
  }

  /** Just the env file, for a plugin the user already has checked out. */
  function pluginEnv(id: string): Promise<PluginEnvResponse> {
    return nodeRegistryApi.pluginEnv(id)
  }

  return {
    all,
    items,
    actionsOf,
    loading,
    error,
    isRemote,
    states,
    refresh,
    probe,
    probeAll,
    save,
    remove,
    sync,
    installInfo,
    pluginEnv,
  }
})

/** An empty install spec — the shape a row carries when the user brings their
 *  own checkout (no repo, just the env the plugin needs). */
export function emptyInstall(): InstallSpec {
  return { repo: '', ref: '', subdir: '', runtime: 'auto', envFile: '.env.inflow', env: [] }
}
