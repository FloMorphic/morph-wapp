import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PromptTemplate } from '@/types/api'
import { promptsApi, type SavePromptInput } from '@/api/prompts'

/**
 * Prompt-template list state (the Prompts index page). Page-based pagination
 * matching the morph-api `/prompt` endpoints.
 */
export const usePromptsStore = defineStore('prompts', () => {
  const items = ref<PromptTemplate[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(12)

  const isRemote = promptsApi.isRemote()

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await promptsApi.list({ page: target, per_page: perPage.value, search: search.value })
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

  async function save(input: SavePromptInput): Promise<PromptTemplate> {
    const rec = await promptsApi.save(input)
    await fetchPage(page.value)
    return rec
  }

  async function remove(id: string): Promise<void> {
    await promptsApi.remove(id)
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(targetPage)
  }

  return {
    items,
    loading,
    error,
    search,
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

export type { SavePromptInput }
