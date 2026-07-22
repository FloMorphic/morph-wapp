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
        { value: 'openai', label: 'OpenAI (or OpenAI-compatible)' },
        { value: 'gemini', label: 'Google Gemini' },
        { value: 'anthropic', label: 'Anthropic (Claude)' },
      ],
      help: 'langchaingo derives the message roles from the provider.',
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
      help: 'Optional custom base URL — leave empty for the provider default. For OpenAI-compatible endpoints, this is the base (…/v1), not the chat-completions path.',
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

export const SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  llm: llmSchema,
  mcp: mcpSchema,
}

/** The typed schema for a node kind, or null when it uses the key/value editor. */
export function settingsSchemaFor(nodeType?: string | null): SettingsSchema | null {
  if (!nodeType) return null
  return SETTINGS_SCHEMAS[nodeType] ?? null
}
