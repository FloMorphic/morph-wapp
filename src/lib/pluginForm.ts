import type { PluginFormBuilder } from '@/types/api'

/**
 * The plugin UI protocol, on the front-end side.
 *
 * An inflowv1 plugin describes every dialog it wants drawn as a
 * {@link PluginFormBuilder}: a JSON Schema plus a JSON Forms UI schema, both
 * carried as *strings* because that is the SDK's wire format. It serves them on
 * two reserved descriptors —
 *
 *   `@intro` / `@settings`        the profile a plugin needs before any action
 *                                 runs (its onboarding form)
 *   `<action>.@form`              the parameters of one action (the form its
 *                                 canvas node's drawer renders)
 *
 * — and both are rendered by the same component (components/plugin/PluginForm),
 * so a plugin only ever has to speak this one protocol to get a UI.
 *
 * This module is the boundary where a plugin's document becomes something the
 * renderer can take: it parses, tolerates the several shapes the wire actually
 * produces, and never throws. A plugin is a third party — a malformed form is
 * its bug, and it must degrade to "no form" rather than break the drawer.
 */

/** A schema/uischema pair, parsed and ready for JSON Forms. */
export interface PluginForm {
  schema: Record<string, unknown>
  /** Absent when the plugin shipped no UI schema — JSON Forms then generates a
   *  layout from the schema itself, which is the sane default. */
  uischema?: Record<string, unknown>
}

/**
 * One form document → a plain object.
 *
 * Accepts both shapes the wire produces: the SDK's JSON-in-a-string, and the
 * already-decoded object the backend stores on a synced palette row
 * (`params.schema` / `params.ui`). Anything else — unparseable, an array, a
 * scalar — reads as "nothing here".
 */
export function parseFormDoc(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return undefined
    try {
      return asRecord(JSON.parse(text))
    } catch {
      return undefined
    }
  }
  return asRecord(raw)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return Object.keys(record).length ? record : undefined
}

/**
 * An SDK form descriptor → a renderable form, or null when it describes none.
 *
 * "None" is a normal answer, not a failure: an action that takes no parameters
 * and a plugin that needs no settings both legitimately advertise an empty
 * form, and callers show their own "nothing to fill in" note for it.
 */
export function toPluginForm(form: PluginFormBuilder | null | undefined): PluginForm | null {
  if (!form) return null
  return buildForm(parseFormDoc(form.jsonschema), parseFormDoc(form.jsonui))
}

/**
 * The same, from a palette row's stored `params` — already-decoded objects
 * rather than the SDK's strings. Used for the form stamped onto a canvas node,
 * which is what its drawer falls back to when the plugin is down.
 */
export function toStoredPluginForm(params: { schema?: unknown; ui?: unknown } | null | undefined): PluginForm | null {
  if (!params) return null
  return buildForm(parseFormDoc(params.schema), parseFormDoc(params.ui))
}

function buildForm(
  schema: Record<string, unknown> | undefined,
  uischema: Record<string, unknown> | undefined,
): PluginForm | null {
  if (!schema || !hasFields(schema)) return null
  // A UI schema is only usable if it names a JSON Forms element type; a plugin
  // that sent `{}` (or the backend's empty-object placeholder) gets the
  // generated layout instead of an element JSON Forms cannot dispatch.
  return uischema && typeof uischema.type === 'string' ? { schema, uischema } : { schema }
}

/** Whether a JSON Schema actually asks for anything. */
export function hasFields(schema: Record<string, unknown> | null | undefined): boolean {
  const properties = schema?.properties
  return !!properties && typeof properties === 'object' && Object.keys(properties as object).length > 0
}

/**
 * Seed values for a fresh form: the `default` of every top-level property that
 * declares one.
 *
 * JSON Forms only materialises a default once its control is touched, so a form
 * submitted untouched would drop them. Plugins lean on defaults to mean
 * something ("deployment": "cloud"), so they are applied up front — under any
 * value the user already has, never over it.
 */
export function withSchemaDefaults(
  schema: Record<string, unknown> | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const properties = (schema?.properties ?? {}) as Record<string, { default?: unknown }>
  const seeded: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(properties)) {
    if (property && typeof property === 'object' && property.default !== undefined) seeded[key] = property.default
  }
  return { ...seeded, ...values }
}
