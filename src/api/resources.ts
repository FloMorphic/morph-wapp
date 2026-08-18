import type { AddInflowResourceInput, InflowResourcePool } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * Inflow engine dispatch-pool client — the set of engine instances a workflow
 * run can be sent to, surfaced in the settings "Engine resources" panel.
 *
 * Unlike the other repositories there is no local fallback: the pool is runtime
 * state owned by the inflow-fusion SDK on the backend (loaded from infra, kept in
 * a round-robin), so it only exists when a backend is connected. Every call
 * returns the whole pool view so the caller can render the fresh state after any
 * mutation.
 */
export const resourcesApi = {
  isRemote: (): boolean => apiEnabled(),

  /** The live dispatch pool and the currently pinned resource. */
  list: (): Promise<InflowResourcePool> => http.get<InflowResourcePool>('/resource'),

  /** Add one engine instance by hand; it is liveness-probed before it joins. */
  add: (input: AddInflowResourceInput): Promise<InflowResourcePool> =>
    http.post<InflowResourcePool>('/resource', input),

  /** Pin all dispatch to one resource, by name or url. */
  pin: (resource: string): Promise<InflowResourcePool> =>
    http.post<InflowResourcePool>('/resource/pin', { resource }),

  /** Release the pin — back to round-robin across the whole pool. */
  unpin: (): Promise<InflowResourcePool> => http.post<InflowResourcePool>('/resource/unpin'),

  /** Re-read the pool from infra (drops hand-added resources). */
  reload: (): Promise<InflowResourcePool> => http.post<InflowResourcePool>('/resource/reload'),
}
