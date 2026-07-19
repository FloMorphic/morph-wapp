import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MemoryStore } from '@/types/api'
import { memoryApi, type AddMemoryInput } from '@/api/memory'

export const useMemoryStore = defineStore('memory', () => {
  const items = ref<MemoryStore[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isRemote = memoryApi.isRemote()

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      items.value = await memoryApi.list()
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function add(input: AddMemoryInput): Promise<void> {
    await memoryApi.add(input)
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await memoryApi.remove(id)
    await refresh()
  }

  return { items, loading, error, isRemote, refresh, add, remove }
})
