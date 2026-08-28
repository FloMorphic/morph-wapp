import { ref } from 'vue'
import { addCollection, type IconifyJSON } from '@iconify/vue'

/**
 * Offline Material Design Icons for plugin-supplied action icons.
 *
 * FloMorphic's own UI draws from the small curated inline set in `lib/icons`.
 * Plugins, however, pick an icon per action from a shared, documented library —
 * Material Design Icons (`mdi:<name>`, e.g. `mdi:database`) — so their nodes can
 * look distinct without every icon being hand-added here. The whole collection
 * is ~7.6k icons / ~3 MB, so it is bundled as its own async chunk and pulled in
 * only the first time a plugin icon actually needs to render, never on cold load.
 *
 * `mdiReady` flips true once the collection is registered; `components/ui/Icon`
 * gates the Iconify render on it so an icon requested mid-load appears the moment
 * the chunk lands instead of staying blank.
 */
export const mdiReady = ref(false)

let started = false

/** Register the MDI collection once, lazily. Safe to call on every icon render. */
export function ensureMdi(): void {
  if (started) return
  started = true
  import('@iconify-json/mdi/icons.json')
    .then((mod) => {
      const data = (mod as { default?: IconifyJSON }).default ?? (mod as unknown as IconifyJSON)
      addCollection(data)
      mdiReady.value = true
    })
    .catch(() => {
      // Offline data missing (e.g. a build without the dep): plugin icons fall
      // back to the local set / generic plug, the app keeps working.
    })
}
