import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { NodeSetting } from '@/types/api'
import { nodeSettingsApi, type SaveNodeSettingInput } from '@/api/nodeSettings'

/**
 * Node settings-profile list state (the Node Settings index page). Page-based
 * pagination matching the morph-api `/settings` endpoints, with an optional
 * `node` filter to scope the list to one node's profiles.
 *
 * The node drawer's selector talks to `nodeSettingsApi.listForNode` directly (it
 * needs a node-scoped list independent of this page state), so it is not wired
 * through here.
 */
export const useNodeSettingsStore = defineStore('nodeSettings', () => {
  const items = ref<NodeSetting[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const node = ref('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(24)

  const isRemote = nodeSettingsApi.isRemote()

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await nodeSettingsApi.list({
        page: target,
        per_page: perPage.value,
        search: search.value,
        node: node.value || undefined,
      })
      items.value = res.list
      page.value = res.page
      totalPages.value = res.total_pages
      total.value = res.total
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    await fetchPage(1)
  }

  async function next(): Promise<void> {
    if (page.value >= totalPages.value) return
    await fetchPage(page.value + 1)
  }

  async function prev(): Promise<void> {
    if (page.value <= 1) return
    await fetchPage(page.value - 1)
  }

  async function setSearch(value: string): Promise<void> {
    search.value = value
    await refresh()
  }

  async function save(input: SaveNodeSettingInput): Promise<NodeSetting> {
    const rec = await nodeSettingsApi.save(input)
    await fetchPage(page.value)
    return rec
  }

  async function remove(id: string): Promise<void> {
    await nodeSettingsApi.remove(id)
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(targetPage)
  }

  return {
    items,
    loading,
    error,
    search,
    node,
    isRemote,
    page,
    total,
    totalPages,
    hasPrev: () => page.value > 1,
    hasNext: () => page.value < totalPages.value,
    fetchPage,
    refresh,
    next,
    prev,
    setSearch,
    save,
    remove,
  }
})

export type { SaveNodeSettingInput }
