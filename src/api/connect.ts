import type { ConnectConnection, ConnectProbeResult } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * Connect client — the central OpenConnector (oomol) integration.
 *
 * Two surfaces mirror the `flomorphic-api` `/connect` controller:
 *  - Connection management: CRUD over the stored gateway connections (hosted
 *    oomol or self-hosted OpenConnector). Tokens are write-only — sent on save,
 *    never returned (reads carry `tokenSet` / `tokenPreview`).
 *  - Gateway passthrough (`gatewayGet` / `gatewayPost`): forwards to the
 *    OpenConnector REST surface with the stored token injected server-side, so
 *    the browser reaches providers / connections / OAuth / actions without ever
 *    holding a provider credential. `connectionId` targets a specific
 *    connection; omit it to use the default.
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

  /** Authenticated POST passthrough to the gateway (e.g. execute an action). */
  gatewayPost: <T>(subpath: string, body?: unknown, connectionId?: string): Promise<T> =>
    http.post<T>(gatewayPath(subpath, connectionId), body),

  /** Authenticated PUT passthrough (e.g. store an API-key connection). */
  gatewayPut: <T>(subpath: string, body?: unknown, connectionId?: string): Promise<T> =>
    http.put<T>(gatewayPath(subpath, connectionId), body),

  /** The catalog of connectable apps/providers on the gateway. */
  listProviders: (connectionId?: string): Promise<OcEnvelope> =>
    http.get<OcEnvelope>(gatewayPath('/api/providers', connectionId)),

  /** The apps this connection has already connected (OAuth / API-key). */
  listGatewayConnections: (connectionId?: string): Promise<OcEnvelope> =>
    http.get<OcEnvelope>(gatewayPath('/api/connections', connectionId)),

  /** Start an interactive OAuth authorization for a provider; the returned
   *  `authorizationUrl` is opened in a new tab for the user to approve. */
  startOAuth: (service: string, connectionId?: string): Promise<OcEnvelope> =>
    http.post<OcEnvelope>(gatewayPath('/api/oauth/authorizations', connectionId), { service }),
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
