<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { NodeSetting } from '@/types/api'
import { nodeSettingsApi } from '@/api/nodeSettings'
import { nodeUniqLabel } from '@/lib/nodeSettings'
import { settingsSchemaFor, type SettingsField } from '@/lib/settingsSchemas'
import { fetchOpenRouterModels, type OpenRouterModel } from '@/lib/openrouter'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * Create / edit one settings profile. Shared by the Node Settings overview page
 * and the node drawer's selector.
 *
 * Node kinds with a finalized settings model (see settingsSchemas) get a typed
 * form whose fields match the SDK contract exactly. Every other kind edits
 * `settings` as free-form key/value rows; each value is stored as JSON when it
 * parses (numbers, booleans, objects) and as a plain string otherwise — so
 * simple tokens stay simple while richer config is still expressible.
 */
const props = defineProps<{
  open: boolean
  /** The profile to edit; omit / null to create a new one. */
  record?: NodeSetting | null
  /** Preset the node identity (e.g. when adding from a node drawer). */
  nodeUniqId?: string
  /** The node's kind, set by the frontend (not the user) when creating from a
   * node drawer. Preserved from the record when editing. */
  nodeType?: string
  /** Lock the node identity field (creating from a specific node). */
  lockNode?: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', record: NodeSetting): void }>()

interface Row {
  key: string
  value: string
}

const form = reactive<{
  id?: string
  nodeUniqId: string
  nodeType: string
  title: string
  /** Generic key/value editor state (kinds without a typed schema). */
  rows: Row[]
  /** Typed editor state (kinds with a schema): field key → string input. */
  values: Record<string, string>
}>({
  id: undefined,
  nodeUniqId: '',
  nodeType: '',
  title: '',
  rows: [{ key: '', value: '' }],
  values: {},
})
const submitting = ref(false)
const formError = ref<string | null>(null)

// The typed schema for the profile being edited, or null → key/value editor.
const schema = computed(() => settingsSchemaFor(form.nodeType))

// ---- OpenRouter live model picker ------------------------------------------
// The `openrouter` provider can enumerate its catalog client-side, so the model
// field becomes a searchable datalist instead of raw free text. Any other
// provider (or a fetch failure) keeps the plain text input.
const modelOptions = ref<OpenRouterModel[]>([])
const modelsLoading = ref(false)
const modelsError = ref<string | null>(null)

const providerValue = computed(() => (form.values['provider'] ?? '').trim().toLowerCase())
const supportsModelList = computed(() => providerValue.value === 'openrouter')

async function loadModels(force = false) {
  if (!supportsModelList.value) return
  modelsLoading.value = true
  modelsError.value = null
  try {
    modelOptions.value = await fetchOpenRouterModels(force)
  } catch (err) {
    modelsError.value = (err as Error).message
    modelOptions.value = []
  } finally {
    modelsLoading.value = false
  }
}

// Lazily load the catalog the first time an OpenRouter profile is shown (on open
// or when the provider is switched to openrouter). Cached across opens.
watch(
  [() => props.open, providerValue],
  ([open]) => {
    if (open && supportsModelList.value && !modelOptions.value.length && !modelsLoading.value) {
      void loadModels()
    }
  },
  { immediate: true },
)

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  // Only treat clearly-structured input as JSON; a bare token stays a string.
  if (/^(\{|\[|-?\d|true$|false$|null$|")/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      /* fall through to string */
    }
  }
  return raw
}

function rowsFromSettings(settings: Record<string, unknown>): Row[] {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value: stringifyValue(value) }))
  return rows.length ? rows : [{ key: '', value: '' }]
}

// Seed the typed editor: existing values win, otherwise the field default (as
// text), otherwise empty. Every schema field gets a slot so v-model is stable.
function valuesFromSettings(fields: SettingsField[], settings: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of fields) {
    const existing = settings[f.key]
    if (existing !== undefined && existing !== null && existing !== '') {
      values[f.key] = stringifyValue(existing)
    } else if (f.default !== undefined) {
      values[f.key] = String(f.default)
    } else {
      values[f.key] = ''
    }
  }
  return values
}

// Re-seed the form whenever the modal opens.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    formError.value = null
    const record = props.record
    const nodeType = record?.nodeType ?? props.nodeType ?? ''
    const settings = record?.settings ?? {}
    const activeSchema = settingsSchemaFor(nodeType)

    form.id = record?.id
    form.nodeUniqId = record?.nodeUniqId ?? props.nodeUniqId ?? ''
    form.nodeType = nodeType
    form.title = record?.title ?? ''
    form.rows = record ? rowsFromSettings(settings) : [{ key: '', value: '' }]
    form.values = activeSchema ? valuesFromSettings(activeSchema.fields, settings) : {}
  },
  { immediate: true },
)

// Build the typed profile's `settings` from the schema + entered values. Numbers
// are coerced; blank optional fields (and max_tokens-style `0`s) are omitted so
// the SDK falls back to its own defaults.
function settingsFromSchema(fields: SettingsField[]): { settings: Record<string, unknown>; missing: string[] } {
  const settings: Record<string, unknown> = {}
  const missing: string[] = []
  for (const f of fields) {
    const raw = (form.values[f.key] ?? '').trim()
    if (raw === '') {
      if (f.required) missing.push(f.label)
      continue
    }
    if (f.type === 'number') {
      const n = Number(raw)
      if (Number.isNaN(n)) {
        missing.push(f.label)
        continue
      }
      settings[f.key] = n
    } else {
      settings[f.key] = raw
    }
  }
  return { settings, missing }
}

function addRow() {
  form.rows.push({ key: '', value: '' })
}
function removeRow(i: number) {
  form.rows.splice(i, 1)
}

async function submit() {
  formError.value = null
  const nodeUniqId = form.nodeUniqId.trim()
  if (!nodeUniqId) {
    formError.value = 'A node identity (nodeUniqId) is required.'
    return
  }
  if (!form.title.trim()) {
    formError.value = 'Give the profile a name.'
    return
  }

  let settings: Record<string, unknown>
  const activeSchema = schema.value
  if (activeSchema) {
    const built = settingsFromSchema(activeSchema.fields)
    if (built.missing.length) {
      formError.value = `Required: ${built.missing.join(', ')}.`
      return
    }
    settings = built.settings
  } else {
    settings = {}
    for (const row of form.rows) {
      const key = row.key.trim()
      if (!key) continue
      settings[key] = parseValue(row.value)
    }
  }
  submitting.value = true
  try {
    const saved = await nodeSettingsApi.save({
      id: form.id,
      nodeUniqId,
      nodeType: form.nodeType,
      title: form.title.trim(),
      settings,
    })
    emit('saved', saved)
    emit('close')
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    :title="form.id ? 'Edit settings profile' : 'New settings profile'"
    :subtitle="schema ? schema.summary : 'A named key/value config reusable across every instance of this node.'"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Profile name</label>
          <input v-model="form.title" class="input" placeholder="e.g. OpenAI prod" />
        </div>
        <div class="space-y-1">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Node</label>
          <input
            v-if="lockNode"
            :value="nodeUniqLabel(form.nodeUniqId)"
            class="input bg-surface-2"
            disabled
          />
          <input
            v-else
            v-model="form.nodeUniqId"
            class="input font-mono text-xs"
            placeholder="e.g. llm or ext:my-plugin"
          />
        </div>
      </div>

      <!-- Typed editor: kinds with a finalized settings model (e.g. LLM). -->
      <div v-if="schema" class="space-y-3">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Settings</label>
        <div v-for="field in schema.fields" :key="field.key" class="space-y-1">
          <div class="flex items-baseline justify-between gap-2">
            <label class="text-xs font-medium text-fg">
              {{ field.label }}
              <span v-if="field.required" class="text-danger">*</span>
            </label>
            <span class="font-mono text-[10px] text-fg-subtle">{{ field.key }}</span>
          </div>
          <input
            v-if="field.type === 'number'"
            v-model="form.values[field.key]"
            type="number"
            class="input"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :placeholder="field.placeholder"
          />
          <select
            v-else-if="field.type === 'select'"
            v-model="form.values[field.key]"
            class="input"
          >
            <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <template v-else-if="field.key === 'model' && supportsModelList">
            <input
              v-model="form.values[field.key]"
              class="input"
              :placeholder="field.placeholder || 'vendor/model, e.g. anthropic/claude-3.5-sonnet'"
              list="openrouter-model-options"
              autocomplete="off"
              spellcheck="false"
            />
            <datalist id="openrouter-model-options">
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
            </datalist>
            <p class="text-[11px] text-fg-subtle">
              <span v-if="modelsLoading">Loading OpenRouter models…</span>
              <span v-else-if="modelsError" class="text-danger">
                Couldn’t load the catalog ({{ modelsError }}) — type the model id manually.
                <button type="button" class="text-accent hover:underline" @click="loadModels(true)">retry</button>
              </span>
              <span v-else>
                {{ modelOptions.length }} OpenRouter models — start typing to filter, or enter any id.
                <button type="button" class="text-accent hover:underline" @click="loadModels(true)">refresh</button>
              </span>
            </p>
          </template>
          <input
            v-else
            v-model="form.values[field.key]"
            :type="field.type === 'password' ? 'password' : 'text'"
            class="input"
            :placeholder="field.placeholder"
            autocomplete="off"
            spellcheck="false"
          />
          <p v-if="field.help && !(field.key === 'model' && supportsModelList)" class="text-[11px] text-fg-subtle">{{ field.help }}</p>
        </div>
      </div>

      <!-- Generic key/value editor: kinds without a typed schema. -->
      <div v-else class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Settings</label>
          <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addRow">
            <Icon name="plus" :size="13" /> Add field
          </button>
        </div>
        <div v-for="(row, i) in form.rows" :key="i" class="flex items-center gap-2">
          <input v-model="row.key" class="input w-40 font-mono text-xs" placeholder="key" />
          <input v-model="row.value" class="input flex-1 font-mono text-xs" placeholder="value" />
          <button
            class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
            @click="removeRow(i)"
          >
            <Icon name="x" :size="15" />
          </button>
        </div>
        <p class="text-[11px] text-fg-subtle">
          Values are stored as text; JSON-looking values (numbers, <code>true</code>, <code>{…}</code>) are parsed.
        </p>
      </div>

      <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
    </div>

    <template #footer>
      <Button @click="emit('close')">Cancel</Button>
      <Button variant="primary" :icon="form.id ? 'save' : 'plus'" :disabled="submitting" @click="submit">
        {{ submitting ? 'Saving…' : form.id ? 'Save profile' : 'Create profile' }}
      </Button>
    </template>
  </Modal>
</template>
