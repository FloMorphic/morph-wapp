import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ExtensionKind, ExtensionRecord } from '@/types/api'
import { nodeRegistryApi, type RegistryListParams, type SaveExtensionInput } from '@/api/nodeRegistry'

/**
 * Node registry store — the palette's node definitions (`/extension`). Scoped by
 * `kind` so the Settings admin panel drives builtins and (later) the portal
 * drives extensions from the same source.
 */
export const useNodeRegistryStore = defineStore('nodeRegistry', () => {
  const items = ref<ExtensionRecord[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isRemote = nodeRegistryApi.isRemote()

  async function refresh(params?: RegistryListParams): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const page = await nodeRegistryApi.list({ per_page: 100, ...params })
      items.value = page.list
      total.value = page.total
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  /** Convenience: refresh scoped to one origin. */
  function refreshKind(kind: ExtensionKind): Promise<void> {
    return refresh({ kind })
  }

  async function save(input: SaveExtensionInput): Promise<ExtensionRecord> {
    const saved = await nodeRegistryApi.save(input)
    return saved
  }

  async function remove(id: string): Promise<void> {
    await nodeRegistryApi.remove(id)
    items.value = items.value.filter((e) => e.id !== id)
  }

  return { items, total, loading, error, isRemote, refresh, refreshKind, save, remove }
})
