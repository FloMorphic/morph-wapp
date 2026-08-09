<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { NodeSetting, PluginIntro } from '@/types/api'
import { nodeSettingsApi } from '@/api/nodeSettings'
import { nodeUniqLabel } from '@/lib/nodeSettings'
import { settingsSchemaFor, type SettingsField } from '@/lib/settingsSchemas'
import { fetchOpenRouterModels, type OpenRouterModel } from '@/lib/openrouter'
import { fetchPluginRegistrations, pluginRegistration, type PluginRegistration } from '@/lib/nodeExtRefs'
import { fetchPluginIntro } from '@/lib/pluginSettings'
import { toPluginForm, withSchemaDefaults } from '@/lib/pluginForm'
import { NODE_LIST } from '@/data/nodeCatalog'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import PluginForm from '@/components/plugin/PluginForm.vue'

/**
 * Create / edit one settings profile. Shared by the Node Settings overview page
 * and the node drawer's selector.
 *
 * Which editor is shown is decided by who owns the settings contract:
 *
 *   an imported plugin — the plugin does. Its form is read live from
 *                        `@intro` / `@settings` and rendered exactly as the
 *                        Extensions portal's onboarding renders it, so a
 *                        profile can't be filled in with keys the plugin never
 *                        asked for. This is the only authority: what a plugin
 *                        needs changes between deploys, so nothing about the
 *                        form is stored on our side.
 *   a finalized builtin — we do (see settingsSchemas): a typed form whose
 *                        fields match the SDK contract exactly.
 *   anything else       — nobody does, so `settings` is edited as free-form
 *                        key/value rows; each value is stored as JSON when it
 *                        parses (numbers, booleans, objects) and as a plain
 *                        string otherwise. This is also where a plugin that
 *                        didn't answer lands, because that is indistinguishable
 *                        from one that needs nothing.
 *
 * The node identity a profile is filed under (`nodeUniqId` — `ext:<pluginId>`
 * for a plugin) is never a field to type into: it is an address the caller
 * already knows, used to scope the database lookup, so it is shown as
 * information at the top. Only the overview page's "new profile" has no address
 * yet, and it picks one from the buckets that exist rather than inventing one.
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

// ---- The plugin's own settings form ----------------------------------------
// A profile filed under `ext:<pluginId>` belongs to an imported plugin, and the
// plugin is the authority on what it holds. Its form is fetched live every time
// the dialog opens — a redeploy can change it, and nothing here is a cache of it.

/** The imported plugin this profile belongs to, or '' for a builtin bucket. */
const pluginId = computed(() => (form.nodeUniqId.startsWith('ext:') ? form.nodeUniqId.slice(4) : ''))

const registration = ref<PluginRegistration | null>(null)
const pluginIntro = ref<PluginIntro | null>(null)
const pluginLoading = ref(false)
/** Values of the rendered plugin form — what gets saved as `settings`. */
const pluginValues = ref<Record<string, unknown>>({})

const pluginForm = computed(() => (pluginId.value ? toPluginForm(pluginIntro.value?.settings) : null))

/** The plugin's name for the header. Falls back to the id: a profile can outlive
 *  the registration it was filed under, and it still has to be editable. */
const pluginName = computed(() => registration.value?.name || pluginIntro.value?.name || '')

// Only the newest read may write: the drawer can be switched to another node
// while a plugin is still answering, and a late reply must not land on it.
let loadToken = 0

async function loadPluginForm() {
  const token = ++loadToken
  registration.value = null
  pluginIntro.value = null
  pluginValues.value = {}
  const id = pluginId.value
  if (!id) return
  pluginLoading.value = true
  try {
    const reg = await pluginRegistration(id)
    if (token !== loadToken) return
    registration.value = reg
    // No registration row means no address to reach the plugin on — the
    // key/value editor stays, which is what an orphaned profile needs anyway.
    if (!reg) return
    const intro = await fetchPluginIntro(reg.extensionId)
    if (token !== loadToken) return
    pluginIntro.value = intro
  } finally {
    if (token === loadToken) pluginLoading.value = false
  }
}

// Seed the plugin form: the profile's saved values, over whatever defaults its
// schema declares. JSON Forms only materialises a default once its control is
// touched, and a plugin means them — so an untouched form still saves them.
watch(pluginForm, (doc) => {
  pluginValues.value = withSchemaDefaults(doc?.schema, props.record?.settings ?? {})
})

// ---- Where a new profile is filed (overview page only) ----------------------
// Every bucket that can hold one: the plugin-backed builtins, plus each imported
// plugin. The `plugin` spec itself is excluded — it is the shell every imported
// action shares, not a bucket of its own.

const targets = ref<{ value: string; label: string; nodeType: string }[]>([])

async function loadTargets() {
  const builtins = NODE_LIST.filter((s) => s.plugin && s.type !== 'plugin').map((s) => ({
    value: s.type,
    label: s.label,
    nodeType: s.type,
  }))
  const plugins = (await fetchPluginRegistrations()).map((p) => ({
    value: `ext:${p.pluginId}`,
    label: `Plugin · ${p.name}`,
    nodeType: 'plugin',
  }))
  targets.value = [...builtins, ...plugins]
}

const subtitle = computed(() => {
  if (pluginForm.value) return 'The settings this plugin asks for, saved as a profile its nodes can use.'
  if (schema.value) return schema.value.summary
  return 'A named key/value config reusable across every instance of this node.'
})

function onPickTarget(value: string) {
  form.nodeUniqId = value
  form.nodeType = targets.value.find((t) => t.value === value)?.nodeType ?? value
  void loadPluginForm()
}

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

    // Ask the plugin again on every open (its form is live), and offer the
    // buckets a fresh profile can be filed under when none was preset.
    void loadPluginForm()
    if (!props.lockNode && !record) void loadTargets()
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
    // Coerce before trimming: a `type="number"` field binds a number (not a
    // string) once edited, and an existing profile can carry numeric values.
    const raw = String(form.values[f.key] ?? '').trim()
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
    formError.value = 'Pick the node this profile belongs to.'
    return
  }
  if (!form.title.trim()) {
    formError.value = 'Give the profile a name.'
    return
  }

  let settings: Record<string, unknown>
  const activeSchema = schema.value
  if (pluginForm.value) {
    // The plugin asked for exactly these fields; its form's values are the profile.
    settings = { ...(pluginValues.value ?? {}) }
  } else if (activeSchema) {
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
    :subtitle="subtitle"
    :dismissible="false"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <!-- Who this profile belongs to. Shown, not asked: the identity is an
           address the caller already holds (a plugin's own id for a plugin), and
           it exists to scope the lookup, not to be typed in. -->
      <div
        v-if="form.nodeUniqId"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface-2 px-3 py-2 text-[12px]"
      >
        <Icon :name="pluginId ? 'plugin' : 'settings'" :size="14" class="shrink-0 text-accent" />
        <span class="font-medium text-fg">{{ pluginName || nodeUniqLabel(form.nodeUniqId) }}</span>
        <span v-if="pluginIntro?.version" class="chip !bg-surface !text-fg-subtle font-mono text-[10px]">
          {{ pluginIntro.version }}
        </span>
        <span v-if="pluginIntro?.author" class="text-fg-subtle">by {{ pluginIntro.author }}</span>
        <code class="ml-auto truncate font-mono text-[11px] text-fg-subtle" :title="pluginId || form.nodeUniqId">
          {{ pluginId || form.nodeUniqId }}
        </code>
      </div>

      <!-- No identity yet: the overview page's "new profile". Pick a bucket that
           exists rather than typing one. -->
      <div v-else-if="!lockNode" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Node</label>
        <select class="input" :value="form.nodeUniqId" @change="onPickTarget(($event.target as HTMLSelectElement).value)">
          <option value="">Choose a node or plugin…</option>
          <option v-for="t in targets" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <p class="text-[11px] text-fg-subtle">
          The profile is shared by every instance of that node — for a plugin, by every node it contributes.
        </p>
      </div>

      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Profile name</label>
        <input v-model="form.title" class="input" placeholder="e.g. OpenAI prod" />
      </div>

      <!-- The plugin's own form, read live. -->
      <div v-if="pluginLoading" class="py-6 text-center text-sm text-fg-muted">Reading the plugin's requirements…</div>

      <div v-else-if="pluginForm" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin settings</label>
        <PluginForm :form="pluginForm" v-model="pluginValues" :plugin-id="pluginId" :settings="pluginValues" />
      </div>

      <!-- Typed editor: kinds with a finalized settings model (e.g. LLM). -->
      <div v-else-if="schema" class="space-y-3">
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

      <!-- Generic key/value editor: kinds without a typed schema, and plugins
           that couldn't be asked. -->
      <div v-else class="space-y-1.5">
        <!-- A plugin bucket landing here means the plugin served no form. It may
             need none, or may not be able to say so — the two are the same from
             here, so the values are entered by hand rather than refused. -->
        <div v-if="pluginId" class="rounded-lg border border-dashed px-3 py-2.5 text-[12px] text-fg-muted">
          <template v-if="registration">
            This plugin didn't return a settings form. It may need none, or it may not be running —
            <code class="font-mono">@intro</code> and <code class="font-mono">@settings</code> are read from the live
            process, and go unanswered on Go SDK v0.1.3 and earlier. Start it and reopen this dialog, or enter what it
            needs below.
          </template>
          <template v-else>
            No imported plugin is registered under this id any more, so its form can't be read. The values it already
            holds are editable below.
          </template>
        </div>
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
