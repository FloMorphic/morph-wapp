import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { NodeSetting } from '@/types/api'
import { nodeSettingsApi, type SaveNodeSettingInput } from '@/api/nodeSettings'
import {
  orphanSettingsBucket,
  settingsBuckets,
  type SettingsBucket,
} from '@/lib/settingsBuckets'

/**
 * Node settings-profile list state (the Node Settings index page). Page-based
 * pagination matching the morph-api `/settings` endpoints, with a `node` filter
 * that scopes the list to one bucket — the page is browsed one node / plugin at
 * a time, chosen from {@link buckets}.
 *
 * The node drawer's selector talks to `nodeSettingsApi.listForNode` directly (it
 * needs a node-scoped list independent of this page state), so it is not wired
 * through here.
 */

/** A bucket as the page's filter row shows it: the node, plus how many profiles
 *  it holds (over the whole collection, not the page on screen). */
export interface SettingsBucketFacet extends SettingsBucket {
  count: number
}

/** The list endpoint's ceiling (morph-api clamps `per_page` to 100). */
const FACET_PER_PAGE = 100
/** How far the per-bucket tally will page. Profiles are credentials, not
 *  records — an install with more than this has other problems — and the cap
 *  keeps one page load from turning into an unbounded crawl. */
const FACET_MAX_PAGES = 10

export const useNodeSettingsStore = defineStore('nodeSettings', () => {
  const items = ref<NodeSetting[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const node = ref('')

  const page = ref(1)
  const totalPages = ref(1)
  const total = ref(0)
  const perPage = ref(24)

  /** Every bucket, with its profile count — the filter row. */
  const buckets = ref<SettingsBucketFacet[]>([])
  const bucketsLoading = ref(false)
  /** Profiles across every bucket, and whether the tally saw all of them. */
  const profileTotal = ref(0)
  const bucketsPartial = ref(false)

  const isRemote = nodeSettingsApi.isRemote()

  /** The bucket currently being browsed, or null for "all". */
  const activeBucket = computed(() => buckets.value.find((b) => b.nodeUniqId === node.value) ?? null)
  /** A filter is on, so an empty list means "nothing matches", not "nothing exists". */
  const filtered = computed(() => search.value.trim() !== '' || node.value !== '')

  async function fetchPage(target = 1): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await nodeSettingsApi.list({
        page: target,
        per_page: perPage.value,
        search: search.value,
        node: node.value || undefined,
      })
      items.value = res.list
      page.value = res.page
      totalPages.value = res.total_pages
      total.value = res.total
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Rebuild the filter row: the buckets that exist, each with how many profiles
   * it holds. The counts come from walking the unfiltered list (the API has no
   * group-by endpoint), which also surfaces buckets no registration backs any
   * more — their profiles would otherwise be unreachable from this page.
   *
   * Deliberately independent of the current search: the row describes the whole
   * collection, so its counts don't shift under the user while they type.
   */
  async function loadBuckets(): Promise<void> {
    bucketsLoading.value = true
    try {
      const known = await settingsBuckets()
      const tally = new Map<string, number>()
      let seen = 0
      let grand = 0
      let p = 1
      for (;;) {
        const res = await nodeSettingsApi.list({ page: p, per_page: FACET_PER_PAGE })
        grand = res.total
        for (const s of res.list) tally.set(s.nodeUniqId, (tally.get(s.nodeUniqId) ?? 0) + 1)
        seen += res.list.length
        if (!res.list.length || p >= res.total_pages || p >= FACET_MAX_PAGES) break
        p++
      }
      const orphans = [...tally.keys()]
        .filter((id) => !known.some((b) => b.nodeUniqId === id))
        .map(orphanSettingsBucket)
      const facets = [...known, ...orphans].map((b) => ({ ...b, count: tally.get(b.nodeUniqId) ?? 0 }))
      // Buckets holding something come first — the empty ones are still listed
      // (that a plugin has no profile yet is worth seeing) but they are not what
      // the page is about.
      facets.sort((a, b) => (a.count === b.count ? a.label.localeCompare(b.label) : b.count - a.count))
      buckets.value = facets
      profileTotal.value = grand
      bucketsPartial.value = grand > seen
    } catch {
      // The row is an aid, not the page: a failure leaves it empty and the list
      // (which reports its own error) still works.
      buckets.value = []
      bucketsPartial.value = false
    } finally {
      bucketsLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([fetchPage(1), loadBuckets()])
  }

  async function next(): Promise<void> {
    if (page.value >= totalPages.value) return
    await fetchPage(page.value + 1)
  }

  async function prev(): Promise<void> {
    if (page.value <= 1) return
    await fetchPage(page.value - 1)
  }

  async function setSearch(value: string): Promise<void> {
    if (value === search.value) return
    search.value = value
    await fetchPage(1)
  }

  /** Browse one bucket; '' goes back to every profile. */
  async function setNode(value: string): Promise<void> {
    if (value === node.value) return
    node.value = value
    await fetchPage(1)
  }

  /** Drop both filters — the page's way back to "show me everything". */
  async function clearFilters(): Promise<void> {
    if (!filtered.value) return
    search.value = ''
    node.value = ''
    await fetchPage(1)
  }

  async function save(input: SaveNodeSettingInput): Promise<NodeSetting> {
    const rec = await nodeSettingsApi.save(input)
    await Promise.all([fetchPage(page.value), loadBuckets()])
    return rec
  }

  async function remove(id: string): Promise<void> {
    await nodeSettingsApi.remove(id)
    const targetPage = items.value.length === 1 && page.value > 1 ? page.value - 1 : page.value
    await Promise.all([fetchPage(targetPage), loadBuckets()])
  }

  return {
    items,
    loading,
    error,
    search,
    node,
    isRemote,
    page,
    total,
    totalPages,
    perPage,
    buckets,
    bucketsLoading,
    bucketsPartial,
    profileTotal,
    activeBucket,
    filtered,
    hasPrev: () => page.value > 1,
    hasNext: () => page.value < totalPages.value,
    fetchPage,
    refresh,
    loadBuckets,
    next,
    prev,
    setSearch,
    setNode,
    clearFilters,
    save,
    remove,
  }
})

export type { SaveNodeSettingInput }
