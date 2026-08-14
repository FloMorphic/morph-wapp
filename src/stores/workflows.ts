import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FlowRecord, VueFlowGraph } from '@/types/api'
import { flowsApi, type SaveFlowInput } from '@/api/flows'

/**
 * Workflow list state (the Workflows index page). The editor loads/saves single
 * records directly through {@link flowsApi} to keep its lifecycle self-contained.
 */
export const useWorkflowsStore = defineStore('workflows', () => {
  const items = ref<FlowRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(12)

  const isRemote = flowsApi.isRemote()

  /** True once the list has been fetched at least once — so a live `flow.changed`
   * event only refreshes a list the user has actually opened. */
  const loaded = ref(false)
  /** The most recent external flow change seen on the socket, for any view (e.g.
   * the editor) that wants to react to its own open flow being updated. */
  const lastChanged = ref<{ id: string; source: string; at: number } | null>(null)

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await flowsApi.list({ page: target, per_page: perPage.value, search: search.value })
      items.value = res.list
      page.value = res.page
      totalPages.value = res.total_pages
      total.value = res.total
      loaded.value = true
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  // Coalesce bursts (e.g. an agent saving several flows) into one refresh.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void fetchPage(page.value)
    }, 300)
  }

  /**
   * Apply a `flow.changed` socket event (see flomorphic-api api/wslog): a flow
   * was created or updated out-of-band — by an MCP client, another browser tab,
   * or the scheduler. It records the change for other views to observe and, when
   * the list is currently loaded, refreshes the current page so a flow authored
   * elsewhere appears without a manual reload. Payload: `{ id, source }`.
   */
  function ingestFlowChanged(payload: unknown): void {
    const p = (payload ?? {}) as { id?: string; source?: string }
    lastChanged.value = { id: p.id ?? '', source: p.source ?? '', at: Date.now() }
    if (loaded.value) scheduleRefresh()
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

  async function remove(id: string): Promise<void> {
    await flowsApi.remove(id)
    // Stepping back a page if we just deleted the last row on it.
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(targetPage)
  }

  async function save(input: SaveFlowInput): Promise<FlowRecord> {
    return flowsApi.save(input)
  }

  function get(id: string): Promise<FlowRecord> {
    return flowsApi.get(id)
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
    loaded,
    lastChanged,
    hasPrev: () => page.value > 1,
    hasNext: () => page.value < totalPages.value,
    fetchPage,
    refresh,
    next,
    prev,
    setSearch,
    remove,
    save,
    get,
    ingestFlowChanged,
  }
})

export type { VueFlowGraph, SaveFlowInput }
