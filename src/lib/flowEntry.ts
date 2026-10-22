import type { FlowEntryForm, FlowEntryView } from '@/types/api'
import { toStoredPluginForm, type PluginForm } from './pluginForm'

/**
 * A flow's entry form, on the front-end side.
 *
 * A flow can declare the input it needs (`preferences.entry`) instead of
 * growing a JS node after the start node whose only job is to seed the context.
 * The declaration is deliberately writable in two ways, and this module is
 * where that choice is read:
 *
 *   - a JSON Schema — rendered by the plugin form-builder, the same renderer
 *     every plugin dialog uses, with its controls, defaults and validation;
 *   - a plain JSON object of values — the easy way in: the document IS what
 *     gets seeded, shown as a flat key/value table.
 *
 * The rules here mirror the backend's (models.IsSchemaDocument,
 * inflow.EntryDefaults, models.SetAtContextPath) so the form a person sees and
 * the seed the engine writes never disagree.
 */

/** Where entry values land when the form names no target. */
export const ENTRY_TARGET_DEFAULT = '$._entry'

/**
 * A JSON Schema, or a plain object of values?
 *
 * The test is narrow on purpose — a `$schema` declaration, or a non-empty
 * `properties` object — because the alternative document's keys are a person's
 * own data: reading `{"type": "order"}` as a contract would turn their value
 * into a schema keyword. A schema describing no fields is an empty form, so it
 * reads as plain and shows as the empty table it is.
 */
export function isSchemaDocument(doc: Record<string, unknown> | undefined | null): boolean {
  if (!doc || typeof doc !== 'object') return false
  if ('$schema' in doc) return true
  const props = doc.properties
  return !!props && typeof props === 'object' && !Array.isArray(props) && Object.keys(props as object).length > 0
}

/** Whether this entry is written as a JSON Schema (the false case is plain values). */
export function entryIsSchema(entry: FlowEntryForm | null | undefined): boolean {
  return isSchemaDocument(entry?.form?.schema)
}

/** An entry that actually describes something. An empty document is "no form". */
export function entryHasForm(entry: FlowEntryForm | null | undefined): boolean {
  const schema = entry?.form?.schema
  return !!schema && Object.keys(schema).length > 0
}

/** The schema/uischema pair for the form-builder renderer, or null for a
 *  plain-values entry (which has no schema to render). */
export function entryPluginForm(entry: FlowEntryForm | null | undefined): PluginForm | null {
  if (!entryIsSchema(entry)) return null
  return toStoredPluginForm({ schema: entry?.form?.schema, ui: entry?.form?.ui })
}

/**
 * What the fields start at when nobody has typed anything: for a JSON Schema
 * the defaults it declares (nested objects included), and for a plain-values
 * entry the document itself.
 *
 * The backend resolves this too (GET /flow/id/:id/entry) and its answer is the
 * one to prefer — it can also read the live context. This exists for the local
 * (no-backend) mode and for the editor's live preview of a form being written.
 */
export function entryDefaults(entry: FlowEntryForm | null | undefined): Record<string, unknown> {
  const schema = entry?.form?.schema
  if (!schema || !Object.keys(schema).length) return {}
  if (!isSchemaDocument(schema)) return { ...schema }
  return schemaDefaults(schema)
}

function schemaDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const props = schema.properties
  if (!props || typeof props !== 'object') return out
  for (const [name, raw] of Object.entries(props as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const prop = raw as Record<string, unknown>
    if ('default' in prop) {
      out[name] = prop.default
      continue
    }
    if (declaresObject(prop)) {
      const nested = schemaDefaults(prop)
      // A property with no defaults of its own contributes nothing, so an
      // absent field stays absent — a flow reads that differently from `{}`.
      if (Object.keys(nested).length) out[name] = nested
    }
  }
  return out
}

function declaresObject(prop: Record<string, unknown>): boolean {
  const t = prop.type
  if (typeof t === 'string') return t === 'object'
  if (Array.isArray(t)) return t.includes('object')
  return 'properties' in prop
}

/** The entry's write path, defaulted — what a dialog shows as "where this lands". */
export function entryTarget(entry: FlowEntryForm | null | undefined): string {
  const t = entry?.target?.trim()
  return t || ENTRY_TARGET_DEFAULT
}

/**
 * The same plain member paths the backend accepts as a write target: `$`,
 * `$._entry`, `$.input.order`, `$['order id']`. Array, wildcard, filter and
 * descendant paths are rejected — a write needs exactly one destination — and
 * the message is the one shown under the field.
 */
export function validateEntryTarget(path: string): string | null {
  const raw = path.trim()
  if (!raw || raw === '$') return null
  if (/\.\.|[*?@]/.test(raw)) return 'This path selects more than one location — name exactly one member path (e.g. $.input.order).'
  let rest = raw.startsWith('$') ? raw.slice(1) : raw
  while (rest.length) {
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']')
      if (end < 0) return 'Unclosed “[”.'
      const inner = rest.slice(1, end).trim()
      const quoted = inner.length >= 3 && (inner[0] === "'" || inner[0] === '"') && inner[inner.length - 1] === inner[0]
      if (!quoted) return 'Brackets must hold a quoted member name (e.g. $[\'order id\']) — an array index is not a single location.'
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith('.')) {
      rest = rest.slice(1)
      if (!rest.length) return 'The path ends in a dot.'
      if (rest.startsWith('[')) continue
    }
    const next = rest.search(/[.[]/)
    const name = next < 0 ? rest : rest.slice(0, next)
    if (!name) return 'The path has an empty member name.'
    rest = next < 0 ? '' : rest.slice(next)
  }
  return null
}

/** Read the value a context document holds at a plain member path — the local
 *  mode's live prefill, and the twin of models.ValueAtContextPath. */
export function valueAtPath(doc: unknown, path: string): unknown {
  if (validateEntryTarget(path)) return undefined
  const raw = path.trim()
  const rest = raw.startsWith('$') ? raw.slice(1) : raw
  const members = rest.match(/[^.[\]'"]+/g) ?? []
  let cur: unknown = doc
  for (const m of members) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[m]
  }
  return cur
}

/** The view a launcher renders when there is no backend to resolve it: the
 *  entry's own defaults, with a live prefill read out of the given document. */
export function resolveEntryViewLocally(
  entry: FlowEntryForm | null | undefined,
  contextDoc?: unknown,
): FlowEntryView {
  if (!entryHasForm(entry)) {
    return { entry: null, target: ENTRY_TARGET_DEFAULT, prefill: 'default', values: {}, source: 'none' }
  }
  const form = entry as FlowEntryForm
  const target = entryTarget(form)
  const values = entryDefaults(form)
  if (form.prefill === 'live' && contextDoc) {
    const held = valueAtPath(contextDoc, target)
    if (held && typeof held === 'object' && !Array.isArray(held)) {
      // The defaults stay underneath: a field the context says nothing about
      // still shows what the flow would do on its own.
      return { entry: form, target, prefill: 'live', values: { ...values, ...(held as Record<string, unknown>) }, source: 'context' }
    }
  }
  return { entry: form, target, prefill: form.prefill === 'live' ? 'live' : 'default', values, source: 'default' }
}
