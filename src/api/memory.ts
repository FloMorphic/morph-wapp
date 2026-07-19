import type { DocumentMemoryConfig, MemoryStore, MemoryType, VectorMemoryConfig } from '@/types/api'
import { apiEnabled, http } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Memory-store repository.
 *
 * Memory stores are named, reusable stores that Memory nodes in a workflow
 * reference. A Vector store carries an embedding model + token; a Document
 * store carries a table/column schema. Backed by `/memory` when a backend is
 * configured, otherwise localStorage.
 */

const LOCAL_KEY = 'memory'

export interface AddMemoryInput {
  name: string
  type: MemoryType
  description?: string
  vector?: VectorMemoryConfig
  document?: DocumentMemoryConfig
}

function localAll(): MemoryStore[] {
  return readCollection<MemoryStore>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

export const memoryApi = {
  isRemote: apiEnabled,

  list(): Promise<MemoryStore[]> {
    if (apiEnabled()) return http.get<MemoryStore[]>('/memory')
    return Promise.resolve(localAll())
  },

  add(input: AddMemoryInput): Promise<MemoryStore> {
    if (apiEnabled()) return http.post<MemoryStore>('/memory', input)
    const ts = now()
    const record: MemoryStore = {
      id: createId('mem'),
      name: input.name,
      type: input.type,
      description: input.description ?? '',
      vector: input.type === 'vector' ? input.vector : undefined,
      document: input.type === 'document' ? input.document : undefined,
      createdAt: ts,
      updatedAt: ts,
    }
    const all = readCollection<MemoryStore>(LOCAL_KEY)
    all.push(record)
    writeCollection(LOCAL_KEY, all)
    return Promise.resolve(record)
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/memory/${id}`)
    writeCollection(
      LOCAL_KEY,
      readCollection<MemoryStore>(LOCAL_KEY).filter((m) => m.id !== id),
    )
    return Promise.resolve()
  },
}
