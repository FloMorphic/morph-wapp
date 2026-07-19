import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ExtensionStatus, ProjectExtension } from '@/types/api'
import { extensionsApi, type AddExtensionInput } from '@/api/extensions'

export const useExtensionsStore = defineStore('extensions', () => {
  const items = ref<ProjectExtension[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isRemote = extensionsApi.isRemote()

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      items.value = await extensionsApi.list()
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function add(input: AddExtensionInput): Promise<void> {
    await extensionsApi.add(input)
    await refresh()
  }

  async function setStatus(id: string, status: ExtensionStatus): Promise<void> {
    await extensionsApi.setStatus(id, status)
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await extensionsApi.remove(id)
    await refresh()
  }

  return { items, loading, error, isRemote, refresh, add, setStatus, remove }
})
