<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useContextsStore } from '@/stores/contexts'
import type { ContextRecord } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

const store = useContextsStore()
const router = useRouter()
onMounted(() => store.refresh())

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

// Viewing and editing happen on the dedicated context page (ContextDetailView).
function openNew() {
  router.push({ name: 'context-new' })
}

function openContext(c: ContextRecord) {
  router.push({ name: 'context-detail', params: { id: c.id } })
}

/** Parse a JSON string, returning the value or undefined when invalid. */
function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function remove(c: ContextRecord, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete context "${c.title}"?`)) return
  await store.remove(c.id)
}

/** One-line preview of the context document. */
function preview(c: ContextRecord): string {
  const parsed = tryParse(c.context)
  const text = parsed === undefined ? c.context : JSON.stringify(parsed)
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 140 ? `${compact.slice(0, 140)}…` : compact || '{}'
}

/** Number of top-level keys in the context document. */
function keyCount(c: ContextRecord): number {
  const parsed = tryParse(c.context)
  return isPlainObject(parsed) ? Object.keys(parsed).length : 0
}

function formatTime(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <PageShell
    title="Contexts"
    subtitle="The living state that flows through a workflow — a JSON document nodes read from and write to at runtime. Define reusable seed contexts here."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openNew">New context</Button>
    </template>

    <div class="mb-5 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search contexts…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading contexts…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="context"
      title="No contexts yet"
      description="Create a JSON context document to seed a workflow run. Nodes read from and write back to it as the process executes."
    >
      <Button variant="primary" icon="plus" @click="openNew">New context</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="c in store.items"
        :key="c.id"
        class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
        @click="openContext(c)"
      >
        <div class="flex items-start justify-between gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="context" :size="18" />
          </span>
          <span
            class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Delete"
            @click="remove(c, $event)"
          >
            <Icon name="trash" :size="15" />
          </span>
        </div>
        <h3 class="mt-3 truncate font-semibold text-fg">{{ c.title }}</h3>
        <p class="mt-2 line-clamp-3 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-subtle">
          {{ preview(c) }}
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="chip">{{ keyCount(c) }} key{{ keyCount(c) === 1 ? '' : 's' }}</span>
          <span v-if="c.updatedBy?.by" class="chip">{{ c.updatedBy.by === 'flow' ? 'by flow' : 'manual' }}</span>
          <span v-if="c.updatedAt" class="ml-auto text-[11px] text-fg-subtle">{{ formatTime(c.updatedAt) }}</span>
        </div>
      </button>
    </div>

    <div v-if="!store.loading && store.items.length" class="mt-6 flex items-center justify-center gap-3">
      <Button icon="chevron-left" :disabled="!store.hasPrev()" @click="store.prev()">Previous</Button>
      <span class="text-xs text-fg-subtle">Page {{ store.page }} of {{ store.totalPages }} · {{ store.total }} total</span>
      <Button :disabled="!store.hasNext()" @click="store.next()">
        Next <Icon name="chevron-right" :size="15" />
      </Button>
    </div>
  </PageShell>
</template>
