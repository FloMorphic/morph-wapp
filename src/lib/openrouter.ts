/**
 * OpenRouter model catalog.
 *
 * OpenRouter exposes a public, unauthenticated `GET /api/v1/models` that lists
 * every model it can route to (300+, spanning OpenAI / Anthropic / Google /
 * Meta / Mistral / DeepSeek / …). We fetch it directly from the browser so the
 * LLM & MCP settings drawers can offer a live, searchable model picker for the
 * `openrouter` provider — without a backend, a running plugin, or a credential.
 *
 * The fetch is cached for the session (one in-flight promise, reused) and fails
 * soft: callers fall back to free-text model entry, so a blocked request (CSP,
 * offline) never breaks the form.
 */

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'

/** One entry of the OpenRouter catalog, trimmed to what the picker needs. */
export interface OpenRouterModel {
  /** Canonical model id used as the `model` setting, e.g. "anthropic/claude-3.5-sonnet". */
  id: string
  /** Human label from the catalog (falls back to the id). */
  name: string
  /** Max context window in tokens, when the catalog reports it. */
  contextLength?: number
}

/** Raw shape of the catalog rows we read (the endpoint returns much more). */
interface RawModel {
  id: string
  name?: string
  context_length?: number
}

// Session cache: the resolved (or in-flight) catalog. Cleared on failure so a
// later call can retry, and bypassable via `force` for an explicit refresh.
let cache: Promise<OpenRouterModel[]> | null = null

/**
 * Fetch (and cache) the OpenRouter model catalog, sorted by id. Reuses the
 * in-flight/settled promise across callers; pass `force` to refetch. Rejects on
 * network / HTTP / parse failure — the caller decides how to degrade.
 */
export function fetchOpenRouterModels(force = false): Promise<OpenRouterModel[]> {
  if (!force && cache) return cache
  cache = loadModels().catch((err) => {
    cache = null // drop the failed promise so the next call retries
    throw err
  })
  return cache
}

async function loadModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(MODELS_ENDPOINT, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { data?: RawModel[] }
  const rows = Array.isArray(body.data) ? body.data : []
  return rows
    .filter((m) => typeof m.id === 'string' && m.id !== '')
    .map((m) => ({ id: m.id, name: m.name ?? m.id, contextLength: m.context_length }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
