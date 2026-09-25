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

/** The provider half of a model profile, shared by every kind that drives an LLM. */
const providerFields: SettingsField[] = [
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
]

/**
 * How a model call behaves when the provider misbehaves — a deadline on one
 * call and how many further attempts a failed one gets.
 *
 * These describe how reliable a particular ENDPOINT is rather than what the
 * node is asked to do, which is why they sit on the connection profile next to
 * the URL and the token.
 *
 * Neither carries a `default`, and that is deliberate. A seeded default would
 * be written into every profile on the next save, freezing today's number into
 * stored data; left blank the key is omitted entirely and the plugin applies
 * its own, so a later change there reaches profiles nobody has touched. The
 * effective fallback is shown as the placeholder instead.
 *
 * For Retries the blank/zero distinction is the whole point: the plugin reads
 * it as a nullable integer, so blank means "use the default" and an explicit 0
 * means "never retry". Do not give this field a default.
 */
const llmResilienceFields: SettingsField[] = [
  {
    key: 'request_timeout_s',
    label: 'Model call timeout (seconds)',
    type: 'number',
    min: 0,
    step: 1,
    placeholder: '180',
    help: 'Bounds ONE model call. Leave empty for the default (180s). Worth raising only for a slow reasoning model — beyond ~220s the gateway in front of most providers gives up first.',
  },
  {
    key: 'max_retries',
    label: 'Retries',
    type: 'number',
    min: 0,
    step: 1,
    placeholder: '3',
    help: 'Further attempts after a failed call, on transient failures only (5xx, 429, timeouts — never a refusal). Leave empty for the default (3); enter 0 to never retry.',
  },
]

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
  fields: [...providerFields, ...llmResilienceFields],
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
  // The MCP node reads the identical LLMSettings contract, resilience knobs
  // included — the two must stay in lockstep.
  fields: llmSchema.fields,
}

/**
 * HITL node — the provider config the backend `hitl` chat service uses to run
 * the conversation bot with the person. It is the same provider contract as the
 * LLM node (langchaingo-style provider / model / token / base URL), so the
 * fields are reused — but only the provider half: the chat service is the
 * backend's own llm.Config, not the plugin, and it reads neither the call
 * timeout nor the retry count, so offering those knobs here would be a lie.
 * Unlike the LLM node, this profile's values are **not**
 * denormalized onto the node's `data.settings` (see NodeSettingsSelector): the
 * task carries only the profile *id*, and the backend reads the token from the
 * settings store at chat time — so a provider key never rides along in an
 * exported flow graph.
 */
const hitlSchema: SettingsSchema = {
  summary: 'LLM provider config the HITL chat service uses to run the conversation bot.',
  fields: providerFields,
}

/**
 * HTTP node — mirrors the SDK `HTTPSettings` contract the `run` action reads as
 * `body.settings` (see the backend httpSettingsBody projection). These are the
 * connection-level defaults shared by every request the node makes: base URL,
 * auth and TLS/timeout. The per-request method / url / headers / query / body
 * live on the node data and are edited in the node's bespoke config, not here.
 */
const httpSchema: SettingsSchema = {
  summary: 'Connection defaults (base URL, auth, TLS, retries) the HTTP node applies to every request.',
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
      // Nullable on the plugin side, so blank and 0 differ: blank takes the
      // plugin's default, 0 turns retrying off. No `default` here, or every
      // save would freeze today's number into the stored profile — the
      // fallback is shown as the placeholder instead.
      key: 'max_retries',
      label: 'Retries',
      type: 'number',
      min: 0,
      step: 1,
      placeholder: '2',
      help: 'Further attempts after a failed request. Leave empty for the default (2); enter 0 to never retry. GET/PUT/DELETE are retried on any transient failure; POST and PATCH only when the request provably never reached the server, or when the server itself answers 429/503 — so a non-idempotent call is never sent twice.',
    },
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

/**
 * Jev node — mirrors the jev plugin's `JevSettings` struct (the `body.settings`
 * contract its `run` action reads; see the backend jevSettingsBody projection).
 * Jev is one endpoint and one bearer key, so the profile is just that: the key,
 * the model alias and an optional base URL for a proxy or a private deployment.
 */
const jevSchema: SettingsSchema = {
  summary: 'TypeSafe API config the Jev node ships per request (its body.settings contract).',
  fields: [
    {
      key: 'access_token',
      label: 'API key',
      type: 'password',
      required: true,
      placeholder: 'TypeSafe API key',
      help: 'Sent as a bearer token to the System One endpoint.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'text',
      default: 'jev-latest',
      placeholder: 'jev-latest',
      help: 'Model id. "jev-latest" tracks the current release; a vendor-prefixed pinned id such as "typesafe/jev-1.13" keeps a live flow on one decider.',
    },
    {
      key: 'url',
      label: 'Base URL',
      type: 'text',
      placeholder: 'https://thejevai.com',
      help: 'Optional — only for a proxy or a private deployment. The node appends /v1/systemone.',
    },
    {
      key: 'timeout_seconds',
      label: 'Timeout (seconds)',
      type: 'number',
      default: 30,
      min: 0,
      step: 1,
      help: 'Per-call timeout. Jev answers in well under a second; this is a safety net.',
    },
  ],
}

export const SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  llm: llmSchema,
  mcp: mcpSchema,
  http: httpSchema,
  jev: jevSchema,
  hitl: hitlSchema,
}

/** The typed schema for a node kind, or null when it uses the key/value editor. */
export function settingsSchemaFor(nodeType?: string | null): SettingsSchema | null {
  if (!nodeType) return null
  return SETTINGS_SCHEMAS[nodeType] ?? null
}
