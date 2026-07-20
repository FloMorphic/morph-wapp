import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Process, ProcessStatus } from '@/types/api'
import { processesApi } from '@/api/processes'

/**
 * Process run list + the currently open detail. Page-based pagination over the
 * morph-api `/process` endpoints with a lifecycle filter.
 *
 * The filter defaults to `running` because that is what an operator watches by
 * default; the view exposes the other statuses (finished / waiting / …) and an
 * "All" option. There is no create path here — runs are launched from a
 * workflow (see processesApi.start); this store reads, stops and deletes.
 */
export const useProcessesStore = defineStore('processes', () => {
  const items = ref<Process[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  // Default to running — the operator's at-a-glance view.
  const status = ref<ProcessStatus | ''>('running')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(12)

  // The run open in the detail panel.
  const active = ref<Process | null>(null)

  const isRemote = processesApi.isRemote()

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await processesApi.list({
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

  async function setStatus(value: ProcessStatus | ''): Promise<void> {
    status.value = value
    await refresh()
  }

  function open(p: Process): void {
    active.value = p
  }

  function close(): void {
    active.value = null
  }

  async function stop(indexId: number): Promise<void> {
    const updated = await processesApi.stop(indexId)
    const idx = items.value.findIndex((p) => p.indexId === indexId)
    if (idx >= 0) items.value[idx] = updated
    if (active.value?.indexId === indexId) active.value = updated
    // A stopped run leaves the running filter — reflect that immediately.
    if (status.value === 'running') await fetchPage(page.value)
  }

  async function remove(indexId: number): Promise<void> {
    await processesApi.remove(indexId)
    if (active.value?.indexId === indexId) active.value = null
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
    stop,
    remove,
  }
})
