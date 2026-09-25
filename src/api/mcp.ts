import { apiBaseUrl, getAuthToken } from './client'

/**
 * Addressing this install's MCP server from outside the browser.
 *
 * Every FloMorphic API endpoint has a mirror on an MCP server this backend
 * serves, so an MCP client — Claude Desktop, Claude Code, Cursor, Codex — can
 * drive the install directly. That is the supported way to point an AI at
 * FloMorphic: the client holds the credentials and the subscription, and this
 * app holds neither.
 *
 * Everything here is string-building for the connect dialog. There is no
 * transport: the browser never speaks MCP.
 */

/**
 * This install's MCP endpoint, as an EXTERNAL client must address it.
 *
 * The app may reach the API through a relative or proxied base (`/api`), which
 * only means anything inside this page. An MCP client runs outside the browser —
 * a desktop app, a CLI — so the URL is resolved against the page origin into
 * something absolute that can be pasted elsewhere.
 *
 * Empty when no backend is configured; there is no MCP server to point at then.
 */
export function mcpEndpoint(): string {
  const base = apiBaseUrl().replace(/\/$/, '')
  if (!base) return ''
  try {
    return new URL(`${base}/mcp`, window.location.origin).href
  } catch {
    return `${base}/mcp`
  }
}

/**
 * True when the endpoint is loopback — reachable from the API host itself but
 * from nowhere else. Worth saying out loud: a client on another machine will
 * fail with a connection error that looks like FloMorphic's fault.
 */
export function mcpEndpointIsLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * The `mcpServers` block nearly every MCP client accepts — Claude Desktop,
 * Cursor, Windsurf and most others read this shape, differing only in which file
 * it lives in.
 *
 * The bearer is included when this session holds one, because a config without
 * it simply fails against a guarded install. That makes the generated text
 * credential-bearing, which is why the UI renders it behind a reveal.
 */
export function mcpClientConfig(url: string): string {
  const server: Record<string, unknown> = { type: 'http', url }
  const token = getAuthToken()
  if (token) server.headers = { Authorization: `Bearer ${token}` }
  return JSON.stringify({ mcpServers: { flomorphic: server } }, null, 2)
}

/** The Claude Code equivalent, which is a single command rather than a file. */
export function mcpClaudeCodeCommand(url: string): string {
  const token = getAuthToken()
  const header = token ? ` \\\n  --header "Authorization: Bearer ${token}"` : ''
  return `claude mcp add --transport http flomorphic ${url}${header}`
}
