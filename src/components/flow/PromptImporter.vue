<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import { promptsApi } from '@/api/prompts'
import type { PromptTemplate } from '@/types/api'

/**
 * "Import" affordance for a node's prompt box — the bridge between the Prompts
 * library (`/prompt`, see @/api/prompts) and the LLM / MCP drawers' init
 * messages. Renders a small link-style button; clicking it opens a searchable
 * picker, and choosing a prompt writes its `template` text into the bound box
 * (v-model), either replacing what's there or appending after it.
 *
 * It owns its own list state rather than the shared prompts store on purpose:
 * the store backs the Prompts index page, and importing here must not reset the
 * search / page that page is sitting on.
 *
 * The imported text is a plain starting point — the drawer, not the library,
 * owns it from then on. Note the two placeholder dialects: a library template
 * carries its own `{{name}}` variables (documented per prompt), while the node
 * resolves `{{$.path}}` context vars at run time, so imported variables have to
 * be filled in or rewritten as paths by hand. The picker lists a prompt's
 * variables so it's visible what needs doing before the node runs.
 */
const props = defineProps<{
  /** The prompt box's current text. */
  modelValue: string
  /** Which box is being imported into — shown in the picker subtitle. */
  label?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const items = ref<PromptTemplate[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)
const selected = ref<PromptTemplate | null>(null)

const PER_PAGE = 6

async function fetchPage(target = 1) {
  loading.value = true
  error.value = null
  try {
    const res = await promptsApi.list({ page: target, per_page: PER_PAGE, search: search.value })
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

function openPicker() {
  open.value = true
  selected.value = null
  search.value = ''
  fetchPage(1)
}

// Debounced search — one request per pause, not per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchPage(1), 250)
})

/** Single-line preview of a template for the list rows. */
function preview(p: PromptTemplate): string {
  const t = p.template.replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

function apply(mode: 'replace' | 'append') {
  const p = selected.value
  if (!p) return
  const current = props.modelValue ?? ''
  emit('update:modelValue', mode === 'append' && current.trim() ? `${current.trimEnd()}\n\n${p.template}` : p.template)
  open.value = false
}

// Kept out of the template so the literal mustaches never reach the SFC parser.
const varHint = 'This prompt uses {{name}} placeholders — fill them in, or rewrite them as {{$.path}} context vars.'
</script>

<template>
  <button
    class="flex items-center gap-1 text-[12px] text-accent hover:underline"
    title="Import a prompt from the Prompts library"
    @click="openPicker"
  >
    <Icon name="prompt" :size="13" /> Import
  </button>

  <Modal
    :open="open"
    title="Import prompt"
    :subtitle="label ? `Into the ${label} message. The imported text stays editable here.` : 'The imported text stays editable here.'"
    @close="open = false"
  >
    <div class="space-y-3">
      <div class="relative">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="15" />
        </span>
        <input v-model="search" class="input pl-9 text-sm" placeholder="Search prompts…" />
      </div>

      <p v-if="loading" class="py-8 text-center text-sm text-fg-muted">Loading prompts…</p>

      <div v-else-if="error" class="rounded-xl border border-dashed px-4 py-8 text-center">
        <p class="text-sm text-danger">{{ error }}</p>
        <Button class="mt-3" icon="refresh" @click="fetchPage(page)">Retry</Button>
      </div>

      <p v-else-if="items.length === 0" class="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-fg-muted">
        {{ search ? 'No prompt matches that search.' : 'No prompts yet — create one under Prompts, then import it here.' }}
      </p>

      <div v-else class="space-y-2">
        <button
          v-for="p in items"
          :key="p.id"
          class="w-full rounded-xl border p-3 text-left transition-colors hover:border-accent-border"
          :style="selected?.id === p.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined"
          @click="selected = p"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="truncate text-[13px] font-semibold text-fg">{{ p.title }}</h3>
            <Icon v-if="selected?.id === p.id" name="check" :size="15" class="shrink-0 text-accent" />
          </div>
          <p v-if="p.description" class="mt-0.5 line-clamp-1 text-[12px] text-fg-muted">{{ p.description }}</p>
          <p class="mt-1.5 line-clamp-2 rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-subtle">
            {{ preview(p) }}
          </p>
          <div v-if="p.variables.length || p.tags.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span v-for="v in p.variables" :key="v.name" class="chip font-mono">{{ v.name }}</span>
            <span v-for="t in p.tags" :key="t" class="chip">{{ t }}</span>
          </div>
        </button>
      </div>

      <div v-if="!loading && items.length && totalPages > 1" class="flex items-center justify-center gap-3 pt-1">
        <Button icon="chevron-left" :disabled="page <= 1" @click="fetchPage(page - 1)">Previous</Button>
        <span class="text-xs text-fg-subtle">Page {{ page }} of {{ totalPages }} · {{ total }} total</span>
        <Button :disabled="page >= totalPages" @click="fetchPage(page + 1)">
          Next <Icon name="chevron-right" :size="15" />
        </Button>
      </div>

      <p v-if="selected?.variables.length" class="text-[11px] leading-relaxed text-fg-subtle">
        {{ varHint }}
      </p>
    </div>

    <template #footer>
      <Button @click="open = false">Cancel</Button>
      <Button v-if="modelValue.trim()" :disabled="!selected" @click="apply('append')">Append</Button>
      <Button variant="primary" :disabled="!selected" @click="apply('replace')">
        {{ modelValue.trim() ? 'Replace' : 'Insert' }}
      </Button>
    </template>
  </Modal>
</template>
