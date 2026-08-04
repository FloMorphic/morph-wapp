/**
 * Typed settings-profile schemas.
 *
 * Most node kinds edit their settings profile as free-form key/value rows (see
 * NodeSettingsModal). Some kinds, though, have a *finalized* settings model on
 * the SDK/plugin side — the frontend profile must satisfy an exact contract. For
 * those we describe the fields here and render a typed form instead of raw rows,
 * so the profile can't drift from the model the plugin actually reads.
 *
 * A kind is keyed by its `nodeType`. Kinds absent from this registry fall back
 * to the generic key/value editor.
 */

export type SettingsFieldType = 'text' | 'password' | 'number' | 'select'

export interface SettingsField {
  /** Storage key in the profile's `settings` record — must match the SDK model. */
  key: string
  label: string
  type: SettingsFieldType
  /** Choices for `type: 'select'`. */
  options?: { value: string; label: string }[]
  placeholder?: string
  /** Empty/omitted values fail validation on save. */
  required?: boolean
  /** Seeded when creating a new profile (and shown as the effective fallback). */
  default?: string | number
  /** Short hint under the field. */
  help?: string
  // Numeric bounds (type === 'number' only).
  min?: number
  max?: number
  step?: number
}

export interface SettingsSchema {
  /** One-line description shown as the modal subtitle. */
  summary: string
  fields: SettingsField[]
}

/**
 * LLM node — mirrors the SDK `LLMSettings` struct (the `body.settings` contract
 * the `run` action reads). Keep this in lockstep with the Go model:
 * github.com/Inflowenger/go-plugin-sdk → LLM node `LLMSettings`.
 *
 * The node talks to providers through langchaingo, which owns the message body
 * and role mapping. So `provider` is the field that decides the backend, and the
 * profile no longer names the system/user/assistant roles — they're derived from
 * the provider.
 */
const llmSchema: SettingsSchema = {
  summary: 'Provider config the LLM node ships per request (its body.settings contract).',
  fields: [
    {
      key: 'provider',
      label: 'Provider',
      type: 'select',
      required: true,
      default: 'openai',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'openrouter', label: 'OpenRouter (300+ models, one key)' },
        { value: 'openai-compatible', label: 'OpenAI-compatible (Ollama, Groq, Together, vLLM…)' },
        { value: 'gemini', label: 'Google Gemini' },
        { value: 'anthropic', label: 'Anthropic (Claude)' },
      ],
      help: 'langchaingo derives the message roles from the provider. OpenRouter & OpenAI-compatible reuse the OpenAI client — set the model as "vendor/model" and (for compatible) the Base URL below.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'text',
      required: true,
      placeholder: 'gemini-2.0-flash',
    },
    {
      key: 'access_token',
      label: 'Access token',
      type: 'password',
      required: true,
      placeholder: 'Bearer token / API key',
    },
    {
      key: 'url',
      label: 'Base URL',
      type: 'text',
      placeholder: 'https://api.openai.com/v1',
      help: 'Optional custom base URL — leave empty for the provider default (OpenRouter defaults automatically). For OpenAI-compatible endpoints, this is the base (…/v1), not the chat-completions path.',
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'number',
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: 'max_tokens',
      label: 'Max tokens',
      type: 'number',
      min: 0,
      step: 1,
      help: 'Optional — leave 0 to let the provider decide.',
    },
  ],
}

/**
 * MCP node — the "With LLM" mode drives a model over the MCP server's tools, so
 * it needs the same provider config as the LLM node. (The MCP *connection* —
 * URL / transport / auth — lives on the node data and is edited in the node's
 * bespoke config, not here.) The "Tool only" mode uses no provider, so the
 * profile picker is hidden for it (see NodeSettingDetails.showSettingsProfile).
 */
const mcpSchema: SettingsSchema = {
  summary: 'LLM provider config the MCP node uses to drive the model in "With LLM" mode.',
  fields: llmSchema.fields,
}

/**
 * HTTP node — mirrors the SDK `HTTPSettings` contract the `run` action reads as
 * `body.settings` (see the backend httpSettingsBody projection). These are the
 * connection-level defaults shared by every request the node makes: base URL,
 * auth and TLS/timeout. The per-request method / url / headers / query / body
 * live on the node data and are edited in the node's bespoke config, not here.
 */
const httpSchema: SettingsSchema = {
  summary: 'Connection defaults (base URL, auth, TLS) the HTTP node applies to every request.',
  fields: [
    {
      key: 'base_url',
      label: 'Base URL',
      type: 'text',
      placeholder: 'https://api.example.com',
      help: 'Optional — prepended to a relative request URL. Leave empty to give each request an absolute URL.',
    },
    {
      key: 'auth_type',
      label: 'Auth',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'basic', label: 'Basic (username / password)' },
        { value: 'bearer', label: 'Bearer token' },
        { value: 'api_key', label: 'API key header' },
      ],
    },
    { key: 'username', label: 'Username', type: 'text', help: 'Basic auth only.' },
    { key: 'password', label: 'Password', type: 'password', help: 'Basic auth only.' },
    {
      key: 'token',
      label: 'Token',
      type: 'password',
      placeholder: 'Bearer token / API key value',
      help: 'Bearer or API-key auth: the secret sent on every request.',
    },
    {
      key: 'header_name',
      label: 'API-key header',
      type: 'text',
      placeholder: 'X-API-Key',
      help: 'API-key auth only — the header the token is sent under.',
    },
    { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', default: 30, min: 0, step: 1 },
    {
      key: 'insecure_skip_verify',
      label: 'Skip TLS verify',
      type: 'select',
      default: 'false',
      options: [
        { value: 'false', label: 'No (verify certificates)' },
        { value: 'true', label: 'Yes (insecure)' },
      ],
      help: 'Leave off unless calling a host with a self-signed certificate.',
    },
  ],
}

export const SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  llm: llmSchema,
  mcp: mcpSchema,
  http: httpSchema,
}

/** The typed schema for a node kind, or null when it uses the key/value editor. */
export function settingsSchemaFor(nodeType?: string | null): SettingsSchema | null {
  if (!nodeType) return null
  return SETTINGS_SCHEMAS[nodeType] ?? null
}
