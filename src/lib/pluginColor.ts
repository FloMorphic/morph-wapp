function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * A stable accent color for a plugin, derived from its id — and, optionally, a
 * shade of it for one of the plugin's service classes.
 *
 * Every builtin node has a fixed color in the catalog, but all plugin actions
 * share one generic `plugin` spec — so without this they would all render in the
 * same purple. Hashing the `pluginId` to a hue gives each imported plugin its own
 * consistent color; being derived, not random, it is stable across renders,
 * reloads, and machines rather than flickering.
 *
 * When a `className` is given (a multi-service plugin buckets its actions with
 * `tags.class` — `sheet` / `drive` / `doc`, …), the color stays in that plugin's
 * family but shifts to a distinct shade: a small hue rotation plus a lightness
 * step, keyed by the class. So one plugin reads as one spectrum, with each
 * category telling itself apart — while different plugins stay clearly different.
 *
 * Saturation/lightness are held in a band that stays legible as a small icon and
 * a thin ring on the neutral tile in both light and dark themes.
 */
export function pluginColor(pluginId?: string, className?: string): string {
  const id = pluginId?.trim()
  if (!id) return '#8b2fe0' // the plugin spec's default purple, for un-bound nodes
  const baseHue = hash(id) % 360

  const cls = className?.trim()
  if (!cls) return `hsl(${baseHue} 62% 55%)`

  // Keep the class inside the plugin's family: rotate the hue only ±18°, and pick
  // a lightness step in a legible 46–66% band so the categories separate as shades.
  const ch = hash(`${id}/${cls}`)
  const hue = (baseHue + ((ch % 37) - 18) + 360) % 360
  const light = 46 + ((ch >>> 6) % 21)
  return `hsl(${hue} 62% ${light}%)`
}
