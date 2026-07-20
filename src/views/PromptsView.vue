<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { usePromptsStore } from '@/stores/prompts'
import type { PromptTemplate, PromptVariable } from '@/types/api'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'

const store = usePromptsStore()
onMounted(() => store.refresh())

const searchInput = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setSearch(searchInput.value), 250)
}

const showModal = ref(false)
const submitting = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
  id: undefined as string | undefined,
  title: '',
  description: '',
  template: '',
  variables: [] as PromptVariable[],
  tagsText: '',
})

function resetForm() {
  form.id = undefined
  form.title = ''
  form.description = ''
  form.template = ''
  form.variables = []
  form.tagsText = ''
  formError.value = null
}

function openAdd() {
  resetForm()
  showModal.value = true
}

function openEdit(p: PromptTemplate) {
  form.id = p.id
  form.title = p.title
  form.description = p.description
  form.template = p.template
  form.variables = p.variables.map((v) => ({ ...v }))
  form.tagsText = p.tags.join(', ')
  formError.value = null
  showModal.value = true
}

function addVariable() {
  form.variables.push({ name: '', description: '', default: '', required: false })
}
function removeVariable(i: number) {
  form.variables.splice(i, 1)
}

/** Add any `{{placeholder}}` in the template that isn't already a variable. */
function syncFromTemplate() {
  const found = new Set<string>()
  for (const m of form.template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.add(m[1])
  const known = new Set(form.variables.map((v) => v.name))
  for (const name of found) {
    if (!known.has(name)) form.variables.push({ name, description: '', default: '', required: false })
  }
}

async function submit() {
  formError.value = null
  if (!form.title.trim()) {
    formError.value = 'Give the prompt a title.'
    return
  }
  if (!form.template.trim()) {
    formError.value = 'The prompt needs template text.'
    return
  }
  submitting.value = true
  try {
    await store.save({
      id: form.id,
      title: form.title.trim(),
      description: form.description.trim(),
      template: form.template,
      variables: form.variables
        .filter((v) => v.name.trim())
        .map((v) => ({
          name: v.name.trim(),
          description: v.description?.trim() || undefined,
          default: v.default?.trim() || undefined,
          required: v.required || undefined,
        })),
      tags: form.tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
    showModal.value = false
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function remove(p: PromptTemplate, e: Event) {
  e.stopPropagation()
  if (!window.confirm(`Delete prompt "${p.title}"?`)) return
  await store.remove(p.id)
}

function preview(p: PromptTemplate): string {
  const t = p.template.replace(/\s+/g, ' ').trim()
  return t.length > 140 ? `${t.slice(0, 140)}…` : t
}

// Kept as constants so the literal mustaches never reach the SFC template parser.
const templatePlaceholder = 'Summarize the following {{style}}:\n\n{{text}}'
const mustacheHint = '{{name}}'
</script>

<template>
  <PageShell
    title="Prompts"
    subtitle="Reusable prompt templates for AI nodes. Author once with placeholder variables, then reference across workflows."
  >
    <template #actions>
      <Button variant="primary" icon="plus" @click="openAdd">New prompt</Button>
    </template>

    <div class="mb-5 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
          <Icon name="search" :size="16" />
        </span>
        <input v-model="searchInput" class="input pl-9" placeholder="Search prompts…" @input="onSearch" />
      </div>
      <span class="text-xs text-fg-subtle">{{ store.isRemote ? 'morph-api' : 'local storage' }}</span>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading prompts…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refresh()">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="prompt"
      title="No prompts yet"
      description="Create a reusable prompt template with placeholder variables, then reference it from AI nodes in your workflows."
    >
      <Button variant="primary" icon="plus" @click="openAdd">New prompt</Button>
    </EmptyState>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="p in store.items"
        :key="p.id"
        class="card group flex flex-col p-4 text-left transition-colors hover:border-accent-border"
        @click="openEdit(p)"
      >
        <div class="flex items-start justify-between gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="prompt" :size="18" />
          </span>
          <span
            class="rounded-lg p-1.5 text-fg-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
            title="Delete"
            @click="remove(p, $event)"
          >
            <Icon name="trash" :size="15" />
          </span>
        </div>
        <h3 class="mt-3 truncate font-semibold text-fg">{{ p.title }}</h3>
        <p v-if="p.description" class="mt-1 line-clamp-2 text-[13px] text-fg-muted">{{ p.description }}</p>
        <p class="mt-2 line-clamp-3 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg-subtle">
          {{ preview(p) }}
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span v-if="p.variables.length" class="chip">{{ p.variables.length }} var{{ p.variables.length === 1 ? '' : 's' }}</span>
          <span v-for="t in p.tags" :key="t" class="chip">{{ t }}</span>
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

    <!-- Create / edit modal -->
    <Modal
      :open="showModal"
      :title="form.id ? 'Edit prompt' : 'New prompt'"
      subtitle="Referenced by AI nodes in your workflows."
      @close="showModal = false"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Title</label>
            <input v-model="form.title" class="input" placeholder="e.g. Summarize" />
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Tags</label>
            <input v-model="form.tagsText" class="input" placeholder="comma, separated" />
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
          <input v-model="form.description" class="input" placeholder="What this prompt is for" />
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Template</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="syncFromTemplate">
              <Icon name="refresh" :size="13" /> Sync variables
            </button>
          </div>
          <textarea
            v-model="form.template"
            rows="6"
            class="input font-mono text-xs leading-relaxed"
            :placeholder="templatePlaceholder"
          />
          <p class="text-[11px] text-fg-subtle">Use <code>{{ mustacheHint }}</code> placeholders; “Sync variables” lists them below.</p>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Variables</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addVariable">
              <Icon name="plus" :size="13" /> Add variable
            </button>
          </div>
          <p v-if="form.variables.length === 0" class="text-[12px] text-fg-subtle">
            No variables. Add them manually or “Sync variables” from the template.
          </p>
          <div v-for="(v, i) in form.variables" :key="i" class="flex items-center gap-2">
            <input v-model="v.name" class="input w-32 font-mono text-xs" placeholder="name" />
            <input v-model="v.default" class="input flex-1 text-xs" placeholder="default (optional)" />
            <label class="flex shrink-0 items-center gap-1 text-[11px] text-fg-muted" title="Required">
              <input v-model="v.required" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent)]" /> req
            </label>
            <button class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" @click="removeVariable(i)">
              <Icon name="x" :size="15" />
            </button>
          </div>
        </div>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <Button @click="showModal = false">Cancel</Button>
        <Button variant="primary" :icon="form.id ? 'save' : 'plus'" :disabled="submitting" @click="submit">
          {{ submitting ? 'Saving…' : form.id ? 'Save prompt' : 'Create prompt' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
