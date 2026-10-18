import type { DatabaseProbe, DatabaseState, DatabaseTarget } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * Database selection client — which database the backend persists to, and
 * moving it to another one (settings → Database).
 *
 * Like the engine resources there is no local fallback: this is the backend's
 * own persistence config, so the panel only works with a backend connected. A
 * switch takes effect immediately — the API repoints its live store rather than
 * restarting — and **copies no data**: the instance continues against whatever
 * the target database already holds.
 */
export const databaseApi = {
  isRemote: (): boolean => apiEnabled(),

  /** The live database, a health check on it, and the available drivers. */
  state: (): Promise<DatabaseState> => http.get<DatabaseState>('/database'),

  /** Probe a candidate without moving to it. Resolves with `ok: false` for a
   *  database that cannot be used — the reason is in `error`. */
  test: (target: DatabaseTarget): Promise<DatabaseProbe> =>
    http.post<DatabaseProbe>('/database/test', target),

  /** Move the backend onto `target` and persist the selection. Rejects (and
   *  leaves the instance where it was) when the target cannot be opened. */
  switchTo: (target: DatabaseTarget): Promise<DatabaseState> =>
    http.post<DatabaseState>('/database/switch', target),

  /** Forget the saved selection and go back to the backend's environment. */
  reset: (): Promise<DatabaseState> => http.post<DatabaseState>('/database/reset'),
}
