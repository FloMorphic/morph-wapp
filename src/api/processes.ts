import type { Page, PaginationParams, Process, ProcessStatus, StartProcessInput } from '@/types/api'
import { apiEnabled, http, list } from './client'

/**
 * Process run repository.
 *
 * Processes are runtime records: they exist only on the engine-backed
 * `flomorphic-api` (`/process`), written when a workflow run is launched and
 * closed out from the engine's event log. There is no local-storage backend —
 * without a connected backend there is no engine to run anything — so in local
 * mode the list is simply empty and launch/stop are rejected.
 *
 * The UI reads (list / get), launches (start), stops a running run, and deletes
 * a finished row. Identity is the integer `indexId`.
 */

const emptyPage = (params?: ProcessListParams): Page<Process> => ({
  list: [],
  total: 0,
  page: Math.max(1, params?.page ?? 1),
  per_page: params?.per_page ?? 12,
  total_pages: 1,
})

export interface ProcessListParams extends PaginationParams {
  /** Lifecycle filter; '' means any. The Processes view defaults to 'running'. */
  status?: ProcessStatus | ''
  /** Scope to one workflow's runs (e.g. the editor's running-process panel). */
  flowId?: string
  /** Scope to one engine process uuid. */
  pid?: string
}

export const processesApi = {
  isRemote: apiEnabled,

  list(params?: ProcessListParams): Promise<Page<Process>> {
    if (apiEnabled()) return list<Process>('/process', params as Record<string, unknown>)
    return Promise.resolve(emptyPage(params))
  },

  get(indexId: number): Promise<Process> {
    return http.get<Process>(`/process/id/${indexId}`)
  },

  start(input: StartProcessInput): Promise<Process> {
    if (!apiEnabled()) return Promise.reject(new Error('Running a workflow requires a connected backend'))
    return http.post<Process>('/process', input)
  },

  stop(indexId: number): Promise<Process> {
    if (!apiEnabled()) return Promise.reject(new Error('Stopping a run requires a connected backend'))
    return http.post<Process>(`/process/id/${indexId}/stop`, {})
  },

  remove(indexId: number): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/process/id/${indexId}`)
    return Promise.resolve()
  },
}
