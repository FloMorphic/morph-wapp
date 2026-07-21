import type { DocumentRecord, VectorMatch } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * Record-level access to a memory store's data — the endpoints the store data
 * browser uses. Document stores get CRUD over rows; vector stores get an
 * embed-backed similarity search and insert.
 *
 * Unlike the store definitions (memoryApi), records have NO local fallback: a
 * real backend owns the SQL table / vector index, so every call requires
 * VITE_API_BASE_URL and throws a clear error when it is absent.
 */

const REMOTE_ONLY = 'Store data needs a backend. Set VITE_API_BASE_URL to browse and edit records.'

function requireRemote(): void {
  if (!apiEnabled()) throw new Error(REMOTE_ONLY)
}

export interface ListRecordsResult {
  count: number
  items: DocumentRecord[]
}

export interface SearchResult {
  count: number
  items: VectorMatch[]
}

export interface ListRecordsParams {
  limit?: number
  offset?: number
}

export const memoryRecordsApi = {
  isRemote: apiEnabled,

  /** List a document store's rows, newest-first, with limit/offset paging. */
  listRecords(storeId: string, params: ListRecordsParams = {}): Promise<ListRecordsResult> {
    requireRemote()
    return http.get<ListRecordsResult>(`/memory/${storeId}/records`, {
      limit: params.limit,
      offset: params.offset,
    })
  },

  /** Insert one JSON document into a document store. */
  createRecord(storeId: string, doc: Record<string, unknown>): Promise<{ id: string }> {
    requireRemote()
    return http.post<{ id: string }>(`/memory/${storeId}/records`, doc)
  },

  /** Replace an existing document. */
  updateRecord(storeId: string, recordId: string, doc: Record<string, unknown>): Promise<{ id: string }> {
    requireRemote()
    return http.put<{ id: string }>(`/memory/${storeId}/records/${recordId}`, doc)
  },

  /** Remove a document. */
  deleteRecord(storeId: string, recordId: string): Promise<void> {
    requireRemote()
    return http.delete<void>(`/memory/${storeId}/records/${recordId}`)
  },

  /** Embed `text` and return the nearest records in a vector store. */
  search(storeId: string, text: string, topK: number): Promise<SearchResult> {
    requireRemote()
    return http.post<SearchResult>(`/memory/${storeId}/search`, { text, topK })
  },

  /** Embed `text` and index it in a vector store with optional metadata. */
  indexVector(storeId: string, text: string, metadata: Record<string, unknown>): Promise<{ id: string }> {
    requireRemote()
    return http.post<{ id: string }>(`/memory/${storeId}/vectors`, { text, metadata })
  },
}
