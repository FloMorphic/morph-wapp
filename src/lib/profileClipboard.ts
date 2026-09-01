/**
 * Move a settings profile's field values between dialogs as JSON on the
 * clipboard.
 *
 * A profile is just a `Record<string, unknown>` of the values a user filled in;
 * exporting copies that as pretty JSON, importing reads it back. Both settings
 * dialogs (node settings and plugin onboarding) render their fields differently
 * — a live JSON Forms document, a typed schema, or free-form key/value rows —
 * so this file owns only the transport (clipboard + parse). Each dialog decides
 * how the parsed object lands in whichever editor it is showing.
 */

/** Serialize a profile's values and put them on the clipboard. */
export async function copyProfileJson(settings: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(settings ?? {}, null, 2)
  await navigator.clipboard.writeText(json)
}

/**
 * Read the clipboard and parse it as a profile object.
 *
 * Only a JSON object is a profile — an array, a bare number, or malformed text
 * is rejected so a dialog never applies a shape its fields can't hold. Throws a
 * message fit to show the user.
 */
export async function readProfileJson(): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    throw new Error('Could not read the clipboard.')
  }
  const trimmed = text.trim()
  if (!trimmed) throw new Error('The clipboard is empty.')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("The clipboard doesn't contain valid JSON.")
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object of field values.')
  }
  return parsed as Record<string, unknown>
}
