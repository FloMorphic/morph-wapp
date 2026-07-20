import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HumanTask, HumanTaskStatus } from '@/types/api'
import { hitlApi } from '@/api/hitl'

/**
 * Human-in-the-Loop task list + the currently open conversation. Page-based
 * pagination matching the morph-api `/hitl` endpoints, plus a status filter
 * (open / answered / closed). There is no create path — tasks are born from a
 * running workflow's `humanInLoop` node.
 */
export const useHitlStore = defineStore('hitl', () => {
  const items = ref<HumanTask[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const status = ref<HumanTaskStatus | ''>('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(12)

  // The task open in the conversation panel.
  const active = ref<HumanTask | null>(null)

  const isRemote = hitlApi.isRemote()

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await hitlApi.list({
        page: target,
        per_page: perPage.value,
        search: search.value,
        status: status.value,
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

  async function setStatus(value: HumanTaskStatus | ''): Promise<void> {
    status.value = value
    await refresh()
  }

  // Sync the active task and its row in the current page after an action.
  function apply(task: HumanTask): void {
    active.value = task
    const idx = items.value.findIndex((t) => t.id === task.id)
    if (idx >= 0) items.value[idx] = task
  }

  async function open(id: string): Promise<void> {
    active.value = await hitlApi.get(id)
  }

  function close(): void {
    active.value = null
  }

  async function answer(id: string, questionId: string, value: string): Promise<void> {
    apply(await hitlApi.answer(id, questionId, value))
  }

  async function sendMessage(id: string, text: string): Promise<void> {
    apply(await hitlApi.message(id, text, 'human'))
  }

  async function closeTask(id: string): Promise<void> {
    apply(await hitlApi.close(id))
  }

  async function remove(id: string): Promise<void> {
    await hitlApi.remove(id)
    if (active.value?.id === id) active.value = null
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(targetPage)
  }

  return {
    items,
    loading,
    error,
    search,
    status,
    isRemote,
    page,
    total,
    totalPages,
    active,
    hasPrev: () => page.value > 1,
    hasNext: () => page.value < totalPages.value,
    fetchPage,
    refresh,
    next,
    prev,
    setSearch,
    setStatus,
    open,
    close,
    answer,
    sendMessage,
    closeTask,
    remove,
  }
})
