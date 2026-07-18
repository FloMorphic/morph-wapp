<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkflowsStore } from '@/stores/workflows'
import type { FlowRecord } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

const router = useRouter()
const store = useWorkflowsStore()
const searchInput = ref('')

onMounted(() => store.refresh())

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

function open(w: FlowRecord) {
  router.push({ name: 'workflow-edit', params: { id: w.id } })
}

async function remove(w: FlowRecord, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete "${w.title || 'Untitled'}"?`)) return
  await store.remove(w.id)
}

function nodeCount(w: FlowRecord): number {
  return w.view_flow?.nodes?.length ?? 0
}

function formatDate(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <PageShell title="Workflows" subtitle="Design AI-native flows on a visual canvas. Each compiles to Inflowenger primitives at runtime.">
    <template #actions>
      <Button variant="primary" icon="plus" @click="router.push({ name: 'workflow-new' })">New workflow</Button>
    </template>

    <div class="mb-5 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search workflows…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'inspector-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading workflows…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="workflow"
      title="No workflows yet"
      description="Create your first workflow and start dragging agents, models and tools onto the canvas."
    >
      <Button variant="primary" icon="plus" @click="router.push({ name: 'workflow-new' })">New workflow</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="w in store.items"
        :key="w.id"
        class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
        @click="open(w)"
      >
        <div class="flex items-start justify-between gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="workflow" :size="18" />
          </span>
          <span
            class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Delete"
            @click="remove(w, $event)"
          >
            <Icon name="trash" :size="15" />
          </span>
        </div>
        <h3 class="mt-3 truncate font-semibold text-fg">{{ w.title || 'Untitled workflow' }}</h3>
        <div class="mt-1 flex items-center gap-3 text-xs text-fg-subtle">
          <span>{{ nodeCount(w) }} node{{ nodeCount(w) === 1 ? '' : 's' }}</span>
          <span>·</span>
          <span>Updated {{ formatDate(w.updatedAt) }}</span>
        </div>
      </button>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>
  </PageShell>
</template>
