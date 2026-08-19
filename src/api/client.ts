import type { ApiEnvelope, Page, PaginationParams } from '@/types/api'

/**
 * Minimal typed HTTP client for the Inflowenger `flomorphic-api`.
 *
 * The backend wraps every response in `{ data, error }`. This client unwraps
 * `data` on success and throws {@link ApiError} on failure. When no base URL is
 * configured (VITE_API_BASE_URL empty) the client reports itself disabled and
 * the repository layer falls back to local persistence.
 */
export class ApiError extends Error {
  status: number
  payload: unknown
  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

/** Optional bearer token (HS256 handshake used by flomorphic-api). */
let authToken: string | null = null
export function setAuthToken(token: string | null): void {
  authToken = token
}
/** The token currently sent as a bearer, if any. Used by the log socket so it
 *  authenticates the same way the HTTP client does. */
export function getAuthToken(): string | null {
  return authToken
}

/** The configured backend base URL (no trailing slash), or '' when disabled. */
export const apiBaseUrl = (): string => BASE

export const apiEnabled = (): boolean => BASE.length > 0

function toQuery(params?: Record<string, unknown>): string {
  if (!params) return ''
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/**
 * Pull a human-readable message out of the backend's `error` field. The API
 * returns it either as a plain string (a controller's `etc.Send(..., err.Error())`)
 * or as an `{ code, message }` object (`etc.Fail`). Anything else falls back to
 * the raw text so a message is never lost — which matters for the LLM endpoints,
 * whose failures carry the provider's own error text.
 */
function errorDetail(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const s = payload.trim()
    return s.length ? s : null
  }
  if (payload && typeof payload === 'object') {
    const msg = (payload as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return null
}

async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
  if (!apiEnabled()) {
    throw new ApiError('No backend configured (VITE_API_BASE_URL is empty)', 0)
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  let res: Response
  try {
    res = await fetch(`${BASE}${path}${toQuery(params)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new ApiError(`Network error: ${(err as Error).message}`, 0)
  }

  let envelope: ApiEnvelope<T> | null = null
  const text = await res.text()
  if (text) {
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>
    } catch {
      // non-JSON error body
    }
  }

  if (!res.ok) {
    const detail = errorDetail(envelope?.error ?? text)
    throw new ApiError(detail ? `${detail} (${res.status})` : `Request failed (${res.status})`, res.status, envelope?.error ?? text)
  }
  if (envelope?.error) {
    throw new ApiError(errorDetail(envelope.error) ?? 'Backend returned an error', res.status, envelope.error)
  }
  return (envelope?.data as T) ?? (undefined as T)
}

export const http = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** Convenience for the page-paginated list endpoints. */
export function list<T>(path: string, params?: PaginationParams): Promise<Page<T>> {
  return http.get<Page<T>>(path, params as Record<string, unknown>)
}
