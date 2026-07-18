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

  const cursorStack = ref<string[]>([])
  const currentCursor = ref('')
  const nextCursor = ref('')
  const perPage = ref(12)

  const isRemote = flowsApi.isRemote()

  async function fetchPage(cursor = ''): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await flowsApi.list({ cursor, per_page: perPage.value, search: search.value })
      items.value = res.list
      nextCursor.value = res.next
      currentCursor.value = cursor
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    cursorStack.value = []
    await fetchPage('')
  }

  async function next(): Promise<void> {
    if (!nextCursor.value) return
    cursorStack.value.push(currentCursor.value)
    await fetchPage(nextCursor.value)
  }

  async function prev(): Promise<void> {
    const c = cursorStack.value.pop()
    if (c === undefined) return
    await fetchPage(c)
  }

  async function setSearch(value: string): Promise<void> {
    search.value = value
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await flowsApi.remove(id)
    await fetchPage(currentCursor.value)
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
    hasPrev: () => cursorStack.value.length > 0,
    hasNext: () => nextCursor.value !== '',
    fetchPage,
    refresh,
    next,
    prev,
    setSearch,
    remove,
    save,
    get,
  }
})

export type { VueFlowGraph, SaveFlowInput }
