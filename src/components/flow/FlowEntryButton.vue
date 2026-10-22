<script setup lang="ts">
import { computed, ref } from 'vue'
import { flowsApi } from '@/api/flows'
import { useNotificationsStore } from '@/stores/notifications'
import type { FlowEntryForm, FlowPreferences } from '@/types/api'
import { ENTRY_TARGET_DEFAULT, entryDefaults, isSchemaDocument, validateEntryTarget } from '@/lib/flowEntry'
import FlowEntryForm_ from '@/components/flow/FlowEntryForm.vue'
import Button from '@/components/ui/Button.vue'
import CodeEditor from '@/components/ui/CodeEditor.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import ToolButton from '@/components/ui/ToolButton.vue'

/**
 * Editor for a flow's ENTRY FORM — the input it asks for before it runs.
 *
 * This is what replaces the pattern every non-trivial flow grew by hand: a JS
 * node wired after the start node whose only job was to put a fixed shape into
 * the context for the rest of the graph to read. Declared here, the shape is a
 * form the Run dialog renders, a contract an agent reads over MCP, and a seed
 * the backend validates and writes itself.
 *
 * The document is written in whichever way suits the author — a JSON Schema for
 * a real form, or just the JSON to seed — and the preview below shows exactly
 * what the person launching the flow will be handed. It saves on its own route
 * (`PUT /flow/id/:id/preferences`), so editing a form never re-sends the graph.
 */
const props = defineProps<{ flowId?: string }>()
const emit = defineEmits<{ (e: 'saved', preferences: FlowPreferences): void }>()

const notifications = useNotificationsStore()

const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const title = ref('')
const description = ref('')
const schemaText = ref('')
const uiText = ref('')
const target = ref('')
const prefill = ref<'default' | 'live'>('default')
const required = ref(false)
const showAdvanced = ref(false)

/** The values the preview form holds — the operator's view of the defaults. */
const previewValues = ref<Record<string, unknown>>({})

const SAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "orderId": { "type": "string", "title": "Order id" },
    "threshold": { "type": "number", "title": "Score threshold", "default": 10 },
    "notify": { "type": "boolean", "title": "Notify the owner", "default": true }
  },
  "required": ["orderId"]
}`

const SAMPLE_PLAIN = `{
  "orderId": "",
  "threshold": 10,
  "notify": true
}`

function parsed(text: string): { doc?: Record<string, unknown>; error?: string } {
  const raw = text.trim()
  if (!raw) return {}
  try {
    const doc = JSON.parse(raw)
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'The entry document must be a JSON object.' }
    return { doc: doc as Record<string, unknown> }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

const schemaDoc = computed(() => parsed(schemaText.value))
const uiDoc = computed(() => parsed(uiText.value))

/** Which of the two ways this document is written — shown as a badge, because
 *  it decides how the form is rendered and whether anything is validated. */
const kind = computed<'schema' | 'plain' | 'empty'>(() => {
  const doc = schemaDoc.value.doc
  if (!doc || !Object.keys(doc).length) return 'empty'
  return isSchemaDocument(doc) ? 'schema' : 'plain'
})

const targetError = computed(() => validateEntryTarget(target.value || ENTRY_TARGET_DEFAULT))

/** How a node will address a seeded field — the one line that makes the target
 *  concrete for whoever is writing the flow. */
const templateHint = computed(() => {
  const path = target.value.trim() || ENTRY_TARGET_DEFAULT
  return `{{${path === '$' ? '$' : path}.field}}`
})

/** The entry as it would be saved — what the preview renders. */
const draft = computed<FlowEntryForm | null>(() => {
  const doc = schemaDoc.value.doc
  if (!doc || !Object.keys(doc).length) return null
  return {
    title: title.value.trim() || undefined,
    description: description.value.trim() || undefined,
    form: { schema: doc, ui: uiDoc.value.doc },
    target: target.value.trim() || undefined,
    prefill: prefill.value,
    required: required.value,
  }
})

const canSave = computed(
  () => !!props.flowId && !saving.value && !schemaDoc.value.error && !uiDoc.value.error && !targetError.value,
)

async function openDialog() {
  if (!props.flowId) return
  open.value = true
  error.value = null
  loading.value = true
  try {
    const prefs = await flowsApi.getPreferences(props.flowId)
    const entry = prefs.entry
    title.value = entry?.title ?? ''
    description.value = entry?.description ?? ''
    schemaText.value = entry?.form?.schema ? JSON.stringify(entry.form.schema, null, 2) : ''
    uiText.value = entry?.form?.ui ? JSON.stringify(entry.form.ui, null, 2) : ''
    target.value = entry?.target ?? ''
    prefill.value = entry?.prefill === 'live' ? 'live' : 'default'
    required.value = !!entry?.required
    showAdvanced.value = !!entry?.form?.ui
    refreshPreview()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

/** Reset the preview to what a launcher would be handed in default mode. */
function refreshPreview() {
  previewValues.value = entryDefaults(draft.value)
}

function insert(sample: string) {
  schemaText.value = sample
  refreshPreview()
}

async function save() {
  if (!props.flowId || !canSave.value) return
  saving.value = true
  error.value = null
  try {
    const entry = draft.value
    // No document is the clear: an entry that describes no fields is not a
    // form, and the backend stores it the same way as none at all.
    const prefs: FlowPreferences = entry ? { entry } : {}
    const saved = await flowsApi.setPreferences(props.flowId, prefs)
    emit('saved', saved)
    open.value = false
    notifications.notify({
      level: 'success',
      title: entry ? 'Entry form saved' : 'Entry form removed',
      message: entry
        ? `This flow now asks for its input before it runs, seeded at ${entry.target?.trim() || ENTRY_TARGET_DEFAULT}.`
        : 'This flow launches without asking for anything.',
    })
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

function clearForm() {
  schemaText.value = ''
  uiText.value = ''
  title.value = ''
  description.value = ''
  target.value = ''
  prefill.value = 'default'
  required.value = false
  refreshPreview()
}
</script>

<template>
  <div>
    <ToolButton
      icon="prompt"
      label="Entry"
      :disabled="!props.flowId"
      :title="
        props.flowId
          ? 'Entry form — the input this flow asks for before it runs, seeded into the context'
          : 'Save the workflow before giving it an entry form'
      "
      @click="openDialog"
    />

    <Modal
      :open="open"
      title="Entry form"
      subtitle="The input this flow asks for before it runs — seeded into the context, no JS node needed."
      size="xl"
      @close="open = false"
    >
      <div v-if="loading" class="py-6 text-center text-[13px] text-fg-subtle">Loading…</div>

      <div v-else class="grid gap-5 lg:grid-cols-2">
        <!-- Left: the declaration -->
        <div class="space-y-3">
          <div class="space-y-1">
            <label class="flex items-center justify-between text-[12px] font-medium text-fg">
              <span>Entry document</span>
              <span
                class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="
                  kind === 'schema'
                    ? 'bg-accent-soft text-accent'
                    : kind === 'plain'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'bg-fg/5 text-fg-subtle'
                "
              >{{ kind === 'schema' ? 'JSON Schema' : kind === 'plain' ? 'Plain values' : 'empty' }}</span>
            </label>
            <p class="text-[11px] leading-relaxed text-fg-subtle">
              Write a <strong>JSON Schema</strong> for a real form — fields, defaults, enums, required —
              rendered by the same form builder the plugin dialogs use. Or just paste the
              <strong>JSON you want seeded</strong>: it shows as a flat key/value table and is seeded as
              written, with nothing to validate against.
            </p>
            <CodeEditor
              v-model="schemaText"
              language="json"
              inline
              wrap
              placeholder="{ } — a JSON Schema, or the plain JSON to seed"
              @blur="refreshPreview"
            />
            <p v-if="schemaDoc.error" class="text-[11px] text-danger">{{ schemaDoc.error }}</p>
            <div class="flex items-center gap-2 pt-0.5">
              <button type="button" class="text-[11px] text-accent hover:underline" @click="insert(SAMPLE_SCHEMA)">
                Start from a schema
              </button>
              <span class="text-[11px] text-fg-subtle">·</span>
              <button type="button" class="text-[11px] text-accent hover:underline" @click="insert(SAMPLE_PLAIN)">
                Start from plain values
              </button>
              <span class="text-[11px] text-fg-subtle">·</span>
              <button type="button" class="text-[11px] text-fg-subtle hover:text-fg hover:underline" @click="clearForm">
                Clear
              </button>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-[12px] font-medium text-fg">Form title</label>
              <input v-model="title" class="input w-full" placeholder="Order to review" />
            </div>
            <div class="space-y-1">
              <label class="text-[12px] font-medium text-fg">Seeded at</label>
              <input v-model="target" class="input w-full font-mono text-[12px]" :placeholder="ENTRY_TARGET_DEFAULT" />
              <p v-if="targetError" class="text-[11px] text-danger">{{ targetError }}</p>
              <p v-else class="text-[11px] text-fg-subtle">
                One context path, created if it is missing; nothing else in the context is touched. Nodes
                read it as <span class="font-mono">{{ templateHint }}</span>.
              </p>
            </div>
          </div>

          <div class="space-y-1">
            <label class="text-[12px] font-medium text-fg">Description</label>
            <input v-model="description" class="input w-full" placeholder="Shown above the form" />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-[12px] font-medium text-fg">Fields start at</label>
              <select v-model="prefill" class="input w-full">
                <option value="default">The document's own defaults</option>
                <option value="live">What the run's context already holds</option>
              </select>
              <p class="text-[11px] text-fg-subtle">
                Live reads the values at the path above from the context the run is bound to — a re-run
                starts where the last one left off.
              </p>
            </div>
            <div class="space-y-1">
              <label class="text-[12px] font-medium text-fg">Required</label>
              <label class="flex items-start gap-2 pt-1.5 text-[12px] text-fg">
                <input v-model="required" type="checkbox" class="mt-0.5 h-4 w-4" />
                <span>Refuse a launch that supplies nothing and finds nothing at the path.</span>
              </label>
            </div>
          </div>

          <div class="rounded-lg border">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-fg-muted hover:text-fg"
              @click="showAdvanced = !showAdvanced"
            >
              <Icon name="settings" :size="14" />
              <span>UI schema</span>
              <span class="text-[11px] font-normal text-fg-subtle">optional · JSON Forms layout</span>
              <Icon :name="showAdvanced ? 'chevron-down' : 'chevron-right'" :size="14" class="ml-auto text-fg-subtle" />
            </button>
            <div v-if="showAdvanced" class="space-y-1 border-t px-3 py-3">
              <p class="text-[11px] leading-relaxed text-fg-subtle">
                Only meaningful for a JSON Schema document — it groups and labels the controls. Leave it
                empty and the renderer lays the fields out from the schema itself.
              </p>
              <CodeEditor v-model="uiText" language="json" inline wrap placeholder="{ }" />
              <p v-if="uiDoc.error" class="text-[11px] text-danger">{{ uiDoc.error }}</p>
            </div>
          </div>
        </div>

        <!-- Right: what the launcher will see -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[12px] font-medium text-fg">Preview</span>
            <button type="button" class="text-[11px] text-accent hover:underline" @click="refreshPreview">
              Reset to defaults
            </button>
          </div>
          <p class="text-[11px] leading-relaxed text-fg-subtle">
            Exactly what the Run dialog hands the person launching this flow.
          </p>
          <div class="rounded-lg border bg-surface-muted/40 p-3">
            <p v-if="draft?.title" class="mb-1 text-[13px] font-semibold text-fg">{{ draft.title }}</p>
            <p v-if="draft?.description" class="mb-2 text-[11px] text-fg-subtle">{{ draft.description }}</p>
            <FlowEntryForm_ v-if="draft" v-model="previewValues" :entry="draft" />
            <p v-else class="flex items-center gap-2 text-[12px] text-fg-subtle">
              <Icon name="info" :size="14" />
              No entry document — this flow launches without asking for anything.
            </p>
          </div>

          <p class="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            <Icon name="alert-triangle" :size="14" class="mt-0.5 shrink-0" />
            <span>
              Filling this in is the launcher's choice: a trigger, a schedule or an agent can start the
              flow with nothing, and a cleared field arrives empty. If the graph depends on a value,
              check it in a node right after the start node rather than assuming it is there.
            </span>
          </p>
        </div>
      </div>

      <template #footer>
        <p v-if="error" class="mr-auto text-[12px] text-danger">{{ error }}</p>
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="primary" :disabled="!canSave" @click="save">
          {{ saving ? 'Saving…' : draft ? 'Save entry form' : 'Remove entry form' }}
        </Button>
      </template>
    </Modal>
  </div>
</template>
