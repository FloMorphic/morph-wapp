<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageShell from '@/components/ui/PageShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import { useNodeRegistryStore } from '@/stores/nodeRegistry'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import type { ExtensionKind, ExtensionRecord, ExtensionType } from '@/types/api'

/**
 * Node registry admin panel — define the nodes that make up the canvas palette.
 * Builtins ship with FloMorphic (seeded on first run) and are edited here;
 * extensions are inflowv1 plugins imported by users. Mirrors inflow-inspector's
 * extension editor, in FloMorphic's UI. Backed by `/extension`.
 */

const store = useNodeRegistryStore()

const kind = ref<ExtensionKind>('builtin')
onMounted(() => store.refreshKind(kind.value))
watch(kind, (k) => store.refreshKind(k))

// Icon choices come from FloMorphic's local icon set (see @/lib/icons).
const ICON_CHOICES = [
  'node-start', 'node-goto', 'node-wait', 'node-until', 'node-llm', 'node-mcp',
  'node-rule', 'node-code', 'node-docstore', 'node-vecstore', 'node-cast', 'node-human',
]

// Node types offered per origin. Builtins are FloMorphic's 9 morphic node types
// (each lowers to an inflow primitive at compile time); extensions bind as one
// of the two outward-facing execution types.
const BUILTIN_TYPES: ExtensionType[] = ['startNode', 'goto', 'hitl', 'docstore', 'vecstore', 'promissall', 'llm', 'mcp', 'rule', 'js', 'opa', 'until', 'cast']
const EXTENSION_TYPES: ExtensionType[] = ['plugin', 'extrinsic']
const typeOptions = computed<ExtensionType[]>(() => (form.kind === 'builtin' ? BUILTIN_TYPES : EXTENSION_TYPES))

// ---- Editor state ----------------------------------------------------------

const showEditor = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
  kind: 'builtin' as ExtensionKind,
  type: 'startNode' as ExtensionType,
  name: '',
  description: '',
  pluginId: '',
  iconName: 'node-start',
  schemaJson: '{}',
  uiJson: '{}',
  bindTopicKey: '',
  bindValues: {} as Record<string, string>,
})

// Extrinsic services available to bind to (topicKey -> subject template).
const extrinsics = ref<Record<string, string>>({})
const extrinsicKeys = computed(() => Object.keys(extrinsics.value))
const selectedSubject = computed(() => (form.bindTopicKey ? extrinsics.value[form.bindTopicKey] ?? '' : ''))
const subjectVars = computed(() => Array.from(selectedSubject.value.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]))

watch(() => form.bindTopicKey, () => {
  const next: Record<string, string> = {}
  for (const v of subjectVars.value) next[v] = form.bindValues[v] ?? ''
  form.bindValues = next
})

// Keep the type valid when the origin flips.
watch(() => form.kind, () => {
  if (!typeOptions.value.includes(form.type)) form.type = typeOptions.value[0]
})

const schemaError = computed(() => jsonError(form.schemaJson))
const uiError = computed(() => jsonError(form.uiJson))
function jsonError(text: string): string | null {
  try { JSON.parse(text || '{}'); return null } catch (e) { return (e as Error).message }
}

function resetForm(k: ExtensionKind) {
  form.kind = k
  form.type = k === 'builtin' ? 'startNode' : 'plugin'
  form.name = ''
  form.description = ''
  form.pluginId = ''
  form.iconName = 'node-start'
  form.schemaJson = '{}'
  form.uiJson = '{}'
  form.bindTopicKey = ''
  form.bindValues = {}
  formError.value = null
}

async function openNew() {
  editingId.value = null
  resetForm(kind.value)
  extrinsics.value = await nodeRegistryApi.extrinsics().catch(() => ({}))
  showEditor.value = true
}

async function openEdit(ext: ExtensionRecord) {
  editingId.value = ext.id
  form.kind = ext.kind
  form.type = ext.type
  form.name = ext.name
  form.description = ext.description
  form.pluginId = ext.pluginId ?? ''
  form.iconName = ext.icon?.name || 'plugin'
  form.schemaJson = JSON.stringify(ext.params?.schema ?? {}, null, 2)
  form.uiJson = JSON.stringify(ext.params?.ui ?? {}, null, 2)
  form.bindTopicKey = ext.bindTo?.topic_key ?? ''
  form.bindValues = { ...(ext.bindTo?.values ?? {}) }
  formError.value = null
  extrinsics.value = await nodeRegistryApi.extrinsics().catch(() => ({}))
  showEditor.value = true
}

async function submit() {
  formError.value = null
  if (!form.name.trim()) { formError.value = 'Name is required.'; return }
  if (schemaError.value || uiError.value) { formError.value = 'Fix the JSON errors first.'; return }
  saving.value = true
  try {
    await store.save({
      id: editingId.value ?? undefined,
      kind: form.kind,
      type: form.type,
      name: form.name.trim(),
      description: form.description.trim(),
      pluginId: form.kind === 'extension' ? form.pluginId.trim() : '',
      icon: { class: 'flomorphic', name: form.iconName, meta: {} },
      params: { schema: JSON.parse(form.schemaJson || '{}'), ui: JSON.parse(form.uiJson || '{}') },
      bindTo:
        form.type === 'extrinsic'
          ? { topic_key: form.bindTopicKey, values: { ...form.bindValues } }
          : { topic_key: '', values: {} },
    })
    showEditor.value = false
    await store.refreshKind(kind.value)
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

async function remove(ext: ExtensionRecord) {
  if (!window.confirm(`Delete "${ext.name}"? It will no longer appear in the palette.`)) return
  await store.remove(ext.id)
}

function fmtDate(ts: number): string {
  return ts ? new Date(ts).toLocaleDateString() : '—'
}
</script>

<template>
  <PageShell
    title="Node Registry"
    subtitle="Define the nodes that make up the canvas palette. Builtins ship with FloMorphic and are seeded on first run; extensions are inflowv1 plugins imported by users."
  >
    <template #actions>
      <Button variant="primary" icon="plugin" @click="openNew">New {{ kind }} node</Button>
    </template>

    <!-- Origin tabs -->
    <div class="mb-5 flex items-center gap-1 rounded-lg border bg-surface-2 p-1 text-sm w-fit">
      <button
        v-for="k in (['builtin', 'extension'] as ExtensionKind[])"
        :key="k"
        class="rounded-md px-3 py-1.5 font-medium capitalize transition-colors"
        :style="kind === k ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--fg-muted)' }"
        @click="kind = k"
      >
        {{ k }}s
      </button>
    </div>

    <div v-if="store.loading" class="py-16 text-center text-sm text-fg-muted">Loading nodes…</div>

    <div v-else-if="store.error" class="rounded-xl border border-dashed px-6 py-12 text-center">
      <p class="text-sm text-danger">{{ store.error }}</p>
      <Button class="mt-4" icon="refresh" @click="store.refreshKind(kind)">Retry</Button>
    </div>

    <EmptyState
      v-else-if="store.items.length === 0"
      icon="plugin"
      :title="`No ${kind} nodes yet`"
      :description="kind === 'builtin' ? 'Seeded on first run by a connected backend, or add one here.' : 'Import a plugin to add an extension node.'"
    >
      <Button variant="primary" icon="plugin" @click="openNew">New {{ kind }} node</Button>
    </EmptyState>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="ext in store.items" :key="ext.id" class="card flex flex-col p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon :name="ext.icon?.name || 'plugin'" :size="18" />
            </span>
            <div class="min-w-0">
              <h3 class="truncate font-semibold text-fg">{{ ext.name }}</h3>
              <span class="chip !bg-surface-2 !text-fg-subtle font-mono text-[10px]">{{ ext.type }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-accent-soft hover:text-accent" title="Edit" @click="openEdit(ext)">
              <Icon name="settings" :size="15" />
            </button>
            <button class="rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="Delete" @click="remove(ext)">
              <Icon name="trash" :size="15" />
            </button>
          </div>
        </div>
        <p v-if="ext.description" class="mt-3 line-clamp-2 text-[13px] text-fg-muted">{{ ext.description }}</p>
        <div class="mt-3 flex items-center justify-between border-t pt-2.5 text-[11px] text-fg-subtle">
          <span v-if="ext.pluginId" class="truncate font-mono">{{ ext.pluginId }}</span>
          <span v-else class="italic">no plugin</span>
          <span>{{ fmtDate(ext.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- Editor -->
    <Modal
      :open="showEditor"
      :title="editingId ? 'Edit node' : `New ${form.kind} node`"
      subtitle="Palette node definition."
      @close="showEditor = false"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Name</label>
            <input v-model="form.name" class="input" placeholder="e.g. HTTP Request" />
          </div>
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Origin</label>
            <select v-model="form.kind" class="input">
              <option value="builtin">Builtin</option>
              <option value="extension">Extension</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Generic type</label>
            <select v-model="form.type" class="input">
              <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div v-if="form.kind === 'extension'" class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin ID (inflowv1)</label>
            <input v-model="form.pluginId" class="input font-mono text-xs" placeholder="jira-connector" />
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Description</label>
          <input v-model="form.description" class="input" placeholder="What this node does" />
        </div>

        <!-- Icon -->
        <div class="space-y-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Icon</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="ic in ICON_CHOICES"
              :key="ic"
              class="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
              :style="form.iconName === ic ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' } : { color: 'var(--fg-muted)' }"
              :title="ic"
              @click="form.iconName = ic"
            >
              <Icon :name="ic" :size="16" />
            </button>
          </div>
        </div>

        <!-- BindTo (extrinsic types) -->
        <div v-if="form.type === 'extrinsic'" class="space-y-2 rounded-lg border bg-surface-2 p-3">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Bind to backend service</label>
          <select v-model="form.bindTopicKey" class="input">
            <option value="">— select a service —</option>
            <option v-for="k in extrinsicKeys" :key="k" :value="k">{{ k }}</option>
          </select>
          <p v-if="extrinsicKeys.length === 0" class="text-[11px] text-fg-subtle">
            No extrinsic services registered (needs a connected backend with the inflow runtime).
          </p>
          <p v-if="selectedSubject" class="font-mono text-[11px] text-accent">{{ selectedSubject }}</p>
          <div v-for="v in subjectVars" :key="v" class="space-y-1">
            <label class="text-[11px] font-medium text-fg-muted">{{ v }}</label>
            <input v-model="form.bindValues[v]" class="input font-mono text-xs" :placeholder="v" />
          </div>
        </div>

        <!-- Params -->
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Settings schema (JSON)</label>
              <span v-if="schemaError" class="text-[10px] text-danger">invalid</span>
            </div>
            <textarea v-model="form.schemaJson" rows="8" class="input font-mono text-xs" spellcheck="false"></textarea>
          </div>
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">UI schema (JSON)</label>
              <span v-if="uiError" class="text-[10px] text-danger">invalid</span>
            </div>
            <textarea v-model="form.uiJson" rows="8" class="input font-mono text-xs" spellcheck="false"></textarea>
          </div>
        </div>

        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>

      <template #footer>
        <Button @click="showEditor = false">Cancel</Button>
        <Button variant="primary" icon="play-circle" :disabled="saving" @click="submit">
          {{ saving ? 'Saving…' : editingId ? 'Save' : 'Create' }}
        </Button>
      </template>
    </Modal>
  </PageShell>
</template>
