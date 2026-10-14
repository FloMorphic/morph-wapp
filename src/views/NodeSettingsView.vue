<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useNodeSettingsStore, type SettingsBucketFacet } from '@/stores/nodeSettings'
import type { NodeSetting } from '@/types/api'
import { orphanSettingsBucket } from '@/lib/settingsBuckets'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import NodeSettingsModal from '@/components/settings/NodeSettingsModal.vue'

/**
 * The overview of every settings profile the user has configured.
 *
 * The page is browsed one node at a time: the badge row at the top names every
 * bucket a profile can live in — the plugin-backed builtins and each imported
 * plugin — with how many profiles it holds, and picking one scopes the list to
 * it. That is what makes the list honest about pagination: grouping a *page* of
 * profiles by node used to imply each group was complete, when a node's profiles
 * could just as well continue on the next page.
 *
 * Profiles are also created / edited from a node's drawer; this is the one place
 * to see all of them.
 */
const store = useNodeSettingsStore()

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // The store outlives this page (it is a Pinia singleton), so a filter set on
  // an earlier visit is still in force. Show it rather than letting the box read
  // empty while the list is quietly still filtered.
  searchInput.value = store.search
  void store.refresh()
})

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value.trim()), 250)
}

function clearSearch() {
  clearTimeout(searchTimer)
  searchInput.value = ''
  void store.setSearch('')
}

function clearAll() {
  clearTimeout(searchTimer)
  searchInput.value = ''
  void store.clearFilters()
}

const bucketIndex = computed(() => new Map(store.buckets.map((b) => [b.nodeUniqId, b])))

/**
 * The badge row shows what is configured; the buckets holding nothing hide
 * behind a toggle. They are worth reaching — that is where a plugin's first
 * profile gets made — but an install with twenty plugins would otherwise push
 * the list itself off the screen behind a wall of zeroes.
 */
const showEmptyBuckets = ref(false)
const emptyBuckets = computed(() => store.buckets.filter((b) => !b.count && b.nodeUniqId !== store.node))
const shownBuckets = computed(() =>
  showEmptyBuckets.value ? store.buckets : store.buckets.filter((b) => b.count || b.nodeUniqId === store.node),
)

/** The bucket a listed profile belongs to — its icon, colour and name on the
 *  card. A profile whose bucket the filter row doesn't know (its plugin is gone)
 *  still gets one, built from the id it was filed under. */
function bucketOf(s: NodeSetting): SettingsBucketFacet {
  return bucketIndex.value.get(s.nodeUniqId) ?? { ...orphanSettingsBucket(s.nodeUniqId), count: 0 }
}

const rangeLabel = computed(() => {
  if (!store.total) return ''
  const first = (store.page - 1) * store.perPage + 1
  return `${first}–${first + store.items.length - 1} of ${store.total}`
})

// ---- The dialog ------------------------------------------------------------

const showModal = ref(false)
const editing = ref<NodeSetting | null>(null)
/** Pre-file a new profile under a bucket (adding from inside one). */
const presetNode = ref<{ nodeUniqId: string; nodeType: string } | null>(null)

function openAdd(bucket?: SettingsBucketFacet | null) {
  editing.value = null
  presetNode.value = bucket ? { nodeUniqId: bucket.nodeUniqId, nodeType: bucket.nodeType } : null
  showModal.value = true
}
function openEdit(s: NodeSetting) {
  editing.value = s
  presetNode.value = null
  showModal.value = true
}

async function remove(s: NodeSetting, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete settings profile "${s.title}"?`)) return
  await store.remove(s.id)
}

function fieldCount(s: NodeSetting): number {
  return Object.keys(s.settings).length
}
function summarize(s: NodeSetting): string {
  return Object.keys(s.settings).slice(0, 3).join(' · ')
}

/** The selected badge wears its bucket's own colour; the rest stay neutral, so
 *  the row reads as one list with one thing picked out of it. */
function badgeTint(color: string, active: boolean) {
  if (!active) return undefined
  return {
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 45%, var(--line))`,
  }
}
</script>

<template>
  <PageShell
    title="Node Settings"
    subtitle="Reusable settings profiles bound to your nodes. Configure a node's access token, provider and other global settings once, then pick the profile by name from any instance of that node."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd()">New profile</Button>
    </template>

    <!-- Every bucket that holds something, with how much. Picking one scopes
         the list below to it; the buckets holding nothing are one click away,
         because that is where a plugin's first profile gets made. -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button
        class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors"
        :class="
          store.node === ''
            ? 'border-accent-border bg-accent-soft text-accent'
            : 'text-fg-muted hover:border-accent-border hover:text-fg'
        "
        @click="store.setNode('')"
      >
        All
        <span class="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{{ store.profileTotal }}</span>
      </button>

      <button
        v-for="b in shownBuckets"
        :key="b.nodeUniqId"
        class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors"
        :class="[
          store.node === b.nodeUniqId ? 'font-semibold' : 'hover:border-accent-border',
          b.count ? 'text-fg' : 'text-fg-subtle',
        ]"
        :style="badgeTint(b.color, store.node === b.nodeUniqId)"
        :title="b.nodeUniqId"
        @click="store.setNode(b.nodeUniqId)"
      >
        <Icon :name="b.icon" :size="14" :style="{ color: b.color }" />
        <span class="max-w-[14rem] truncate">{{ b.label }}</span>
        <span class="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-fg-muted">{{ b.count }}</span>
      </button>

      <button
        v-if="emptyBuckets.length"
        class="rounded-full px-2 py-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg"
        @click="showEmptyBuckets = !showEmptyBuckets"
      >
        {{ showEmptyBuckets ? 'Hide' : `+${emptyBuckets.length}` }} with no profile
      </button>

      <span v-if="store.bucketsLoading && !store.buckets.length" class="text-xs text-fg-subtle">Reading buckets…</span>
    </div>

    <div class="mb-5 flex flex-wrap items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input
          v-model="searchInput"
          class="input pl-9 pr-9"
          :placeholder="store.activeBucket ? `Search ${store.activeBucket.label} profiles…` : 'Search profiles…'"
          @input="onSearch"
        />
        <button
          v-if="searchInput"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          title="Clear search"
          @click="clearSearch"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>
      <button
        v-if="store.filtered"
        class="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        @click="clearAll"
      >
        Clear filters
      </button>
      <span v-if="store.bucketsPartial" class="text-xs text-fg-subtle" title="Counts are tallied over the first 1000 profiles.">
        counts partial
      </span>
      <span class="ml-auto text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading settings…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <!-- Nothing anywhere. -->
    <EmptyState
      v-else-if="!store.items.length && !store.filtered"
      icon="settings"
      title="No settings profiles yet"
      description="Create a profile here, or open a node in a workflow and add one from its Settings profile box."
    >
      <Button variant="primary" icon="plus" @click="openAdd()">New profile</Button>
    </EmptyState>

    <!-- Nothing *here* — a filter is on, so say which one rather than claiming
         the user has no profiles at all. -->
    <div v-else-if="!store.items.length" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-fg-muted">
        <template v-if="store.search">No profile matches “{{ store.search }}”</template>
        <template v-else>No profile for {{ store.activeBucket?.label ?? store.node }} yet</template>
      </p>
      <div class="mt-4 flex items-center justify-center gap-2">
        <Button v-if="store.activeBucket" variant="primary" icon="plus" @click="openAdd(store.activeBucket)">
          New {{ store.activeBucket.label }} profile
        </Button>
        <Button icon="x" @click="clearAll">Clear filters</Button>
      </div>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <button
        v-for="s in store.items"
        :key="s.id"
        class="card group flex flex-col gap-2 p-3 text-left transition-colors hover:border-accent-border"
        @click="openEdit(s)"
      >
        <div class="flex items-center gap-2">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
            :style="{
              background: 'var(--surface-2)',
              color: bucketOf(s).color,
              borderColor: `color-mix(in srgb, ${bucketOf(s).color} 35%, var(--line))`,
            }"
          >
            <Icon :name="bucketOf(s).icon" :size="15" />
          </span>
          <h3 class="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{{ s.title }}</h3>
          <span
            class="shrink-0 rounded-md p-1 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Delete"
            @click="remove(s, $event)"
          >
            <Icon name="trash" :size="14" />
          </span>
        </div>
        <p class="truncate text-[11px] text-fg-muted">
          <span v-if="!store.node" class="text-fg-subtle">{{ bucketOf(s).label }} · </span>
          {{ fieldCount(s) }} field{{ fieldCount(s) === 1 ? '' : 's' }}
        </p>
        <p v-if="summarize(s)" class="truncate font-mono text-[10px] text-fg-subtle">{{ summarize(s) }}</p>
      </button>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <span class="text-xs text-fg-subtle">Page {{ store.page }} of {{ store.totalPages }} · {{ rangeLabel }}</span>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>

    <NodeSettingsModal
      :open="showModal"
      :record="editing"
      :node-uniq-id="presetNode?.nodeUniqId"
      :node-type="presetNode?.nodeType"
      @close="showModal = false"
      @saved="store.refresh()"
    />
  </PageShell>
</template>
