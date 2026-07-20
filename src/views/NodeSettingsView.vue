<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useNodeSettingsStore } from '@/stores/nodeSettings'
import type { NodeSetting } from '@/types/api'
import { nodeUniqLabel } from '@/lib/nodeSettings'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import NodeSettingsModal from '@/components/settings/NodeSettingsModal.vue'

/**
 * The overview of every settings profile the user has configured, grouped by the
 * node they belong to. This is the single place to see and manage all applied
 * node settings; profiles are also created / edited from a node's drawer.
 */
const store = useNodeSettingsStore()
onMounted(() => store.refresh())

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

// Group the current page's profiles by node identity.
const groups = computed(() => {
  const map = new Map<string, NodeSetting[]>()
  for (const s of store.items) {
    const list = map.get(s.nodeUniqId) ?? []
    list.push(s)
    map.set(s.nodeUniqId, list)
  }
  return [...map.entries()]
    .map(([nodeUniqId, profiles]) => ({ nodeUniqId, label: nodeUniqLabel(nodeUniqId), profiles }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const showModal = ref(false)
const editing = ref<NodeSetting | null>(null)

function openAdd() {
  editing.value = null
  showModal.value = true
}
function openEdit(s: NodeSetting) {
  editing.value = s
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
  return Object.keys(s.settings).slice(0, 4).join(' · ')
}
</script>

<template>
  <PageShell
    title="Node Settings"
    subtitle="Reusable settings profiles bound to your nodes. Configure a node's access token, provider and other global settings once, then pick the profile by name from any instance of that node."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd">New profile</Button>
    </template>

    <div class="mb-5 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search profiles…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading settings…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="settings"
      title="No settings profiles yet"
      description="Create a profile here, or open a node in a workflow and add one from its Settings profile box."
    >
      <Button variant="primary" icon="plus" @click="openAdd">New profile</Button>
    </EmptyState>

    <div v-else class="space-y-6">
      <section v-for="group in groups" :key="group.nodeUniqId">
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold text-fg">{{ group.label }}</h2>
          <span class="chip">{{ group.profiles.length }}</span>
          <code class="font-mono text-[11px] text-fg-subtle">{{ group.nodeUniqId }}</code>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="s in group.profiles"
            :key="s.id"
            class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
            @click="openEdit(s)"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon name="settings" :size="18" />
              </span>
              <span
                class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                title="Delete"
                @click="remove(s, $event)"
              >
                <Icon name="trash" :size="15" />
              </span>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <h3 class="truncate font-semibold text-fg">{{ s.title }}</h3>
              <span v-if="s.nodeType" class="chip shrink-0">{{ s.nodeType }}</span>
            </div>
            <p class="mt-1 truncate font-mono text-[11px] text-fg-subtle">
              {{ fieldCount(s) }} field{{ fieldCount(s) === 1 ? '' : 's' }}{{ summarize(s) ? ' · ' + summarize(s) : '' }}
            </p>
          </button>
        </div>
      </section>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <span class="text-xs text-fg-subtle">Page {{ store.page }} of {{ store.totalPages }} · {{ store.total }} total</span>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>

    <NodeSettingsModal
      :open="showModal"
      :record="editing"
      @close="showModal = false"
      @saved="store.refresh()"
    />
  </PageShell>
</template>
