<script setup lang="ts">
import { computed, ref } from 'vue'
import PluginForm from '@/components/plugin/PluginForm.vue'
import Icon from '@/components/ui/Icon.vue'
import type { FlowEntryForm } from '@/types/api'
import { entryIsSchema, entryPluginForm } from '@/lib/flowEntry'

/**
 * The renderer for a flow's entry form — the input a flow asks for before it
 * runs.
 *
 * A flow declares that input in whichever of two ways suits the person writing
 * it, and this component is where the choice pays off:
 *
 *   - **a JSON Schema** → the plugin form-builder draws it. The same renderer
 *     every plugin dialog uses, so a flow author gets its controls, enums,
 *     defaults, layout and validation for free, and anything that works in a
 *     plugin form works here.
 *   - **a plain JSON object** → a flat key/value table. This is the easy way
 *     in: paste the shape the flow should be given and fill it in. No schema to
 *     write, nothing to learn. A value that is itself an object or an array is
 *     edited as JSON in its row rather than hidden — the table is for flat
 *     documents, and this keeps a nested one honest instead of dropping it.
 *
 * It renders values, nothing else: the launcher owns them, and the backend is
 * what validates and seeds them (one context path, nothing else touched).
 */
const props = defineProps<{
  entry: FlowEntryForm
  modelValue: Record<string, unknown>
  readonly?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

const isSchema = computed(() => entryIsSchema(props.entry))
const pluginForm = computed(() => entryPluginForm(props.entry))

/**
 * The table's rows: every key the entry document declares, plus any the current
 * values carry that it does not (a live prefill read back from a context can
 * hold a key the author has since dropped — showing it is how the operator
 * learns it is there).
 */
const rows = computed(() => {
  const declared = Object.keys(props.entry.form?.schema ?? {})
  const extra = Object.keys(props.modelValue).filter((k) => !declared.includes(k))
  return [...declared, ...extra].map((key) => ({ key, declared: declared.includes(key) }))
})

type Kind = 'string' | 'number' | 'boolean' | 'json'

/**
 * How a row is edited, decided by the declared value's type and falling back to
 * the current value's — the document is the shape, so what the author wrote is
 * what the field should be.
 */
function kindOf(key: string): Kind {
  const declared = (props.entry.form?.schema ?? {})[key]
  const sample = declared !== undefined && declared !== null ? declared : props.modelValue[key]
  if (typeof sample === 'boolean') return 'boolean'
  if (typeof sample === 'number') return 'number'
  if (sample !== null && typeof sample === 'object') return 'json'
  return 'string'
}

function set(key: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

/** A JSON cell keeps the text the person typed until it parses, so a half-typed
 *  object is not thrown away on every keystroke. Invalid JSON is flagged under
 *  the row and simply not committed. */
const jsonDrafts = ref<Record<string, string>>({})
const jsonErrors = ref<Record<string, string>>({})

function jsonText(key: string): string {
  const draft = jsonDrafts.value[key]
  if (draft !== undefined) return draft
  const value = props.modelValue[key]
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function onJson(key: string, text: string) {
  jsonDrafts.value = { ...jsonDrafts.value, [key]: text }
  const errors = { ...jsonErrors.value }
  delete errors[key]
  if (!text.trim()) {
    jsonErrors.value = errors
    set(key, undefined)
    return
  }
  try {
    set(key, JSON.parse(text))
  } catch {
    // Kept as a draft until it parses: the row says so and nothing is committed.
    errors[key] = 'Not valid JSON yet'
  }
  jsonErrors.value = errors
}

function onNumber(key: string, raw: string) {
  const text = raw.trim()
  if (!text) {
    set(key, undefined)
    return
  }
  const n = Number(text)
  // A non-numeric entry is kept as text on purpose: a value may be a
  // {{$.path}} template the engine resolves at run time, exactly as the node
  // forms allow.
  set(key, Number.isNaN(n) ? raw : n)
}
</script>

<template>
  <!-- A JSON Schema entry: the plugin form-builder draws it. -->
  <PluginForm
    v-if="isSchema && pluginForm"
    :form="pluginForm"
    :model-value="props.modelValue"
    :readonly="props.readonly"
    @update:model-value="emit('update:modelValue', $event)"
  />

  <!-- A plain-values entry: a flat key/value table. -->
  <div v-else-if="rows.length" class="divide-y rounded-lg border">
    <div
      v-for="row in rows"
      :key="row.key"
      class="grid grid-cols-[minmax(7rem,10rem)_1fr] items-start gap-3 px-3 py-2"
    >
      <label class="min-w-0 pt-1.5 text-[12px] font-medium text-fg" :for="`entry-${row.key}`">
        <span class="break-words font-mono">{{ row.key }}</span>
        <span
          v-if="!row.declared"
          class="ml-1 text-[10px] font-normal uppercase tracking-wide text-fg-subtle"
          title="In the context already, but not in the flow's entry document"
        >extra</span>
      </label>

      <div class="min-w-0">
        <input
          v-if="kindOf(row.key) === 'boolean'"
          :id="`entry-${row.key}`"
          type="checkbox"
          class="mt-1.5 h-4 w-4"
          :disabled="props.readonly"
          :checked="props.modelValue[row.key] === true"
          @change="set(row.key, ($event.target as HTMLInputElement).checked)"
        />
        <input
          v-else-if="kindOf(row.key) === 'number'"
          :id="`entry-${row.key}`"
          class="input w-full"
          :disabled="props.readonly"
          :value="props.modelValue[row.key] ?? ''"
          @input="onNumber(row.key, ($event.target as HTMLInputElement).value)"
        />
        <textarea
          v-else-if="kindOf(row.key) === 'json'"
          :id="`entry-${row.key}`"
          class="input min-h-[5rem] w-full font-mono text-[11px]"
          :disabled="props.readonly"
          :value="jsonText(row.key)"
          @input="onJson(row.key, ($event.target as HTMLTextAreaElement).value)"
        />
        <input
          v-else
          :id="`entry-${row.key}`"
          class="input w-full"
          :disabled="props.readonly"
          :value="props.modelValue[row.key] ?? ''"
          @input="set(row.key, ($event.target as HTMLInputElement).value)"
        />
        <p v-if="jsonErrors[row.key]" class="mt-1 text-[11px] text-danger">{{ jsonErrors[row.key] }}</p>
      </div>
    </div>
  </div>

  <p v-else class="flex items-center gap-2 text-[12px] text-fg-subtle">
    <Icon name="info" :size="14" />
    This entry form has no fields yet.
  </p>
</template>
