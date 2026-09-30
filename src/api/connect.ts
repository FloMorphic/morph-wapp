import type { ConnectConnection, ConnectProbeResult } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * Connect client — the central OpenConnector (oomol) integration.
 *
 * Two surfaces mirror the `flomorphic-api` `/connect` controller:
 *  - Connection management: CRUD over the stored gateway connections (hosted
 *    oomol or self-hosted OpenConnector). Tokens are write-only — sent on save,
 *    never returned (reads carry `tokenSet` / `tokenPreview`).
 *  - Gateway passthrough (`gatewayGet`, `startOAuth`): forwards to the
 *    OpenConnector REST surface with the stored token injected server-side, so
 *    the browser reaches providers / connections / OAuth without ever holding a
 *    provider credential. `connectionId` targets a specific connection; omit it
 *    to use the default.
 *
 * There is no local fallback: the whole feature needs the backend that stores
 * the token and proxies the gateway, so every call requires a connected API.
 */
function gatewayPath(subpath: string, connectionId?: string): string {
  const clean = subpath.startsWith('/') ? subpath : `/${subpath}`
  const base = `/connect/gateway${clean}`
  if (!connectionId) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}__connection=${encodeURIComponent(connectionId)}`
}

export const connectApi = {
  /** True when a backend is configured — Connect needs one for everything. */
  isRemote: (): boolean => apiEnabled(),

  /** Every configured gateway connection, default first, tokens masked. */
  list: (): Promise<ConnectConnection[]> => http.get<ConnectConnection[]>('/connect/connections'),

  /** Create (no id) or update. Omit `token` on update to keep the stored one. */
  save: (conn: Partial<ConnectConnection>): Promise<ConnectConnection> =>
    http.post<ConnectConnection>('/connect/connections', conn),

  get: (id: string): Promise<ConnectConnection> =>
    http.get<ConnectConnection>(`/connect/connections/id/${encodeURIComponent(id)}`),

  remove: (id: string): Promise<{ id: string }> =>
    http.delete<{ id: string }>(`/connect/connections/id/${encodeURIComponent(id)}`),

  setDefault: (id: string): Promise<ConnectConnection> =>
    http.post<ConnectConnection>(`/connect/connections/id/${encodeURIComponent(id)}/default`),

  /** Probe an ad-hoc base URL + tokens before saving. */
  testInline: (baseUrl: string, token: string, adminToken?: string): Promise<ConnectProbeResult> =>
    http.post<ConnectProbeResult>('/connect/connections/test', { baseUrl, token, adminToken }),

  /** Probe a stored connection with its saved token. */
  testStored: (id: string): Promise<ConnectProbeResult> =>
    http.post<ConnectProbeResult>(`/connect/connections/id/${encodeURIComponent(id)}/test`),

  /** Authenticated GET passthrough to the gateway (e.g. '/api/providers'). */
  gatewayGet: <T>(subpath: string, connectionId?: string): Promise<T> =>
    http.get<T>(gatewayPath(subpath, connectionId)),

  /** Start an interactive OAuth authorization for a provider; the returned
   *  `authorizationUrl` is opened in a new tab for the user to approve. */
  startOAuth: (service: string, connectionId?: string): Promise<OcEnvelope> =>
    http.post<OcEnvelope>(gatewayPath('/api/oauth/authorizations', connectionId), { service }),

  /**
   * The accounts a connection's runtime token can act as, optionally narrowed to
   * one provider (`'telegram'`).
   *
   * This is the execution surface's own view (`/v1/connections`) — the accounts
   * an action call may name by `alias` — which is exactly what a node binding
   * needs. The management listing (`/api/connections`) is a different, admin-only
   * view and is not interchangeable, so this deliberately does not fall back to
   * it: a node must only offer bots that a run will actually be able to use.
   */
  accounts: async (service?: string, connectionId?: string): Promise<OcAccount[]> => {
    const raw = await connectApi.gatewayGet<OcEnvelope<OcAccount[]>>('/v1/connections', connectionId)
    const list = ocUnwrap(raw)
    const all = Array.isArray(list) ? list : []
    return service ? all.filter((a) => a?.service === service) : all
  },
}

/** One account the gateway holds for a provider, as `/v1/connections` reports it:
 *  an OAuth account, an API-key connection, or an always-on no-auth provider.
 *  `alias` is the handle an action call selects it by — the value a node binding
 *  stores. Mirrors the backend's openconnector.Connection. */
export interface OcAccount {
  id: string
  service: string
  /** Gateway-reported health, e.g. 'active'. Shown next to a bot so a designer
   *  can tell a working binding from a revoked one. */
  status?: string
  accountLabel?: string
  alias?: string
  authType?: string
  isDefault?: boolean
}

/** The label to show for an account, falling back through alias then service —
 *  the gateway does not always supply a friendly one. */
export function ocAccountLabel(a: OcAccount): string {
  return a.accountLabel?.trim() || a.alias?.trim() || a.service || a.id
}

/** Whether the gateway considers an account usable. Anything that is not an
 *  explicit failure state counts as usable: builds differ on the vocabulary, and
 *  refusing to offer a working bot because its status string is unfamiliar would
 *  be worse than offering one that later errors. */
export function ocAccountActive(a: OcAccount): boolean {
  const s = (a.status ?? '').trim().toLowerCase()
  return s !== 'expired' && s !== 'revoked' && s !== 'error' && s !== 'disconnected'
}

/** OpenConnector wraps every response as `{ success, message, data, meta }`.
 * The backend proxy relays that object verbatim as our envelope's `data`, so a
 * gateway payload arrives here whole. Field names in `data` vary by build, so
 * callers parse it defensively (see ocUnwrap). */
export interface OcEnvelope<T = unknown> {
  success?: boolean
  message?: string
  data?: T
  meta?: unknown
}

/** Pull the useful payload out of an OpenConnector envelope, tolerating both the
 * wrapped (`{ data }`) and already-unwrapped shapes. */
export function ocUnwrap<T = unknown>(env: OcEnvelope<T> | T): T {
  if (env && typeof env === 'object' && 'data' in (env as object)) {
    return (env as OcEnvelope<T>).data as T
  }
  return env as T
}
