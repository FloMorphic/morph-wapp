<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * Recursive JSON-schema → form field, in the spirit of the MCP inspector's
 * DynamicJsonForm: given a tool's inputSchema it renders one input per
 * property — select for enums, checkbox for booleans, text for strings and
 * numbers, nested fieldsets for objects, add/remove lists for arrays — and
 * falls back to a raw-JSON textarea for shapes it can't express (anyOf/oneOf,
 * untyped fields).
 *
 * Number fields keep non-numeric entries as raw strings so values may embed
 * {{$.path}} context templates; everything else round-trips through the
 * v-model as plain JSON. Optional fields left empty are dropped from the
 * emitted object entirely.
 *
 * The component recurses into itself (by SFC filename) for nested schemas;
 * pass the tool's whole inputSchema at depth 0 and bind the arguments object.
 */
interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  default?: unknown
  [k: string]: unknown
}

const props = withDefaults(
  defineProps<{
    schema: JsonSchema
    modelValue: unknown
    label?: string
    required?: boolean
    depth?: number
  }>(),
  { depth: 0 },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: unknown): void }>()

// ---- Schema shape → field kind --------------------------------------------
type Kind = 'enum' | 'boolean' | 'number' | 'string' | 'object' | 'array' | 'json'

/** Primary type of a schema, tolerating `type: ['string', 'null']` unions. */
function schemaType(s: JsonSchema): string | undefined {
  const t = s.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null')
  return t
}

const kind = computed<Kind>(() => {
  const s = props.schema
  if (Array.isArray(s.enum) && s.enum.length) return 'enum'
  const t = schemaType(s)
  if (t === 'boolean') return 'boolean'
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'string') return 'string'
  if (t === 'object' && s.properties && Object.keys(s.properties).length) return 'object'
  if (t === 'array' && s.items) return 'array'
  return 'json' // anyOf/oneOf, free-form objects, untyped — raw JSON fallback
})

// ---- Object: one child field per property ---------------------------------
const objectEntries = computed(() => Object.entries(props.schema.properties ?? {}))
const requiredKeys = computed(() => new Set(props.schema.required ?? []))

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function setKey(key: string, v: unknown) {
  const next = { ...asObject(props.modelValue) }
  if (v === undefined) delete next[key]
  else next[key] = v
  emit('update:modelValue', next)
}

// ---- Array: add / remove / edit items -------------------------------------
const arrayItems = computed(() => (Array.isArray(props.modelValue) ? (props.modelValue as unknown[]) : []))

/** A sensible starting value for a freshly added array item. */
function emptyFor(s: JsonSchema | undefined): unknown {
  const t = s ? schemaType(s) : undefined
  if (s?.default !== undefined) return s.default
  if (Array.isArray(s?.enum) && s.enum.length) return s.enum[0]
  if (t === 'object') return {}
  if (t === 'array') return []
  if (t === 'boolean') return false
  return ''
}
function addItem() {
  emit('update:modelValue', [...arrayItems.value, emptyFor(props.schema.items)])
}
function removeItem(i: number) {
  const next = [...arrayItems.value]
  next.splice(i, 1)
  emit('update:modelValue', next)
}
function setItem(i: number, v: unknown) {
  const next = [...arrayItems.value]
  next[i] = v
  emit('update:modelValue', next)
}

// ---- Primitives ------------------------------------------------------------
const stringValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : props.modelValue == null ? '' : String(props.modelValue)))

function onStringInput(v: string) {
  emit('update:modelValue', v === '' && !props.required ? undefined : v)
}
function onNumberInput(v: string) {
  const t = v.trim()
  if (t === '') {
    emit('update:modelValue', props.required ? t : undefined)
    return
  }
  // Numeric → number; anything else (e.g. a {{$.path}} template) stays a string.
  const n = Number(t)
  emit('update:modelValue', Number.isFinite(n) ? n : v)
}
function onEnumInput(v: string) {
  if (v === '' && !props.required) {
    emit('update:modelValue', undefined)
    return
  }
  // Emit the original enum member so numbers/booleans keep their type.
  const match = (props.schema.enum ?? []).find((e) => String(e) === v)
  emit('update:modelValue', match ?? v)
}

// ---- Raw-JSON fallback field ----------------------------------------------
const jsonText = ref('')
const jsonError = ref<string | null>(null)
watch(
  () => props.modelValue,
  (v) => {
    // Don't clobber in-progress typing when our own parse round-trips back.
    const current = jsonText.value.trim()
    try {
      if (current && JSON.stringify(JSON.parse(current)) === JSON.stringify(v)) return
    } catch {
      return // invalid text being edited — leave it alone
    }
    jsonText.value = v === undefined ? '' : JSON.stringify(v, null, 2)
    jsonError.value = null
  },
  { immediate: true },
)
function onJsonInput(v: string) {
  jsonText.value = v
  if (!v.trim()) {
    jsonError.value = null
    emit('update:modelValue', undefined)
    return
  }
  try {
    emit('update:modelValue', JSON.parse(v))
    jsonError.value = null
  } catch (e) {
    jsonError.value = (e as Error).message
  }
}

const placeholder = computed(() => {
  const d = props.schema.default
  if (d !== undefined) return typeof d === 'string' ? d : JSON.stringify(d)
  return ''
})
</script>

<template>
  <div class="space-y-1">
    <!-- Field label (skipped for the unnamed top-level object) -->
    <label v-if="label" class="flex items-baseline gap-1 text-[11px] font-medium text-fg-muted">
      <span class="font-mono">{{ label }}</span>
      <span v-if="required" class="text-danger" title="required">*</span>
      <span v-if="schema.description" class="min-w-0 flex-1 truncate font-normal text-fg-subtle" :title="schema.description">
        — {{ schema.description }}
      </span>
    </label>

    <!-- enum → select -->
    <select v-if="kind === 'enum'" class="input text-xs" :value="stringValue" @change="onEnumInput(($event.target as HTMLSelectElement).value)">
      <option v-if="!required" value="">—</option>
      <option v-for="e in schema.enum" :key="String(e)" :value="String(e)">{{ String(e) }}</option>
    </select>

    <!-- boolean → checkbox -->
    <label v-else-if="kind === 'boolean'" class="flex w-fit cursor-pointer items-center gap-2 text-xs text-fg-muted">
      <input
        type="checkbox"
        class="accent-[var(--accent)]"
        :checked="modelValue === true"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      {{ modelValue === true ? 'true' : 'false' }}
    </label>

    <!-- number / integer → text input with numeric coercion ({{$.path}} allowed) -->
    <input
      v-else-if="kind === 'number'"
      class="input font-mono text-xs"
      inputmode="decimal"
      :value="stringValue"
      :placeholder="placeholder || '0'"
      @input="onNumberInput(($event.target as HTMLInputElement).value)"
    />

    <!-- string → text input -->
    <input
      v-else-if="kind === 'string'"
      class="input font-mono text-xs"
      :value="stringValue"
      :placeholder="placeholder"
      @input="onStringInput(($event.target as HTMLInputElement).value)"
    />

    <!-- object → nested fields -->
    <div v-else-if="kind === 'object'" class="space-y-2" :class="depth > 0 ? 'border-l pl-2.5' : ''">
      <JsonSchemaForm
        v-for="[key, child] in objectEntries"
        :key="key"
        :schema="child"
        :model-value="asObject(modelValue)[key] ?? child.default"
        :label="key"
        :required="requiredKeys.has(key)"
        :depth="depth + 1"
        @update:model-value="setKey(key, $event)"
      />
    </div>

    <!-- array → item list with add/remove -->
    <div v-else-if="kind === 'array'" class="space-y-1.5" :class="depth > 0 ? 'border-l pl-2.5' : ''">
      <div v-for="(item, i) in arrayItems" :key="i" class="flex items-start gap-1.5">
        <div class="min-w-0 flex-1">
          <JsonSchemaForm
            :schema="schema.items ?? {}"
            :model-value="item"
            :depth="depth + 1"
            @update:model-value="setItem(i, $event)"
          />
        </div>
        <button
          class="mt-1 shrink-0 rounded-lg p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger"
          title="Remove item"
          @click="removeItem(i)"
        >
          <Icon name="x" :size="13" />
        </button>
      </div>
      <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addItem">
        <Icon name="plus" :size="13" /> Add item
      </button>
    </div>

    <!-- anything else → raw JSON -->
    <template v-else>
      <textarea
        :value="jsonText"
        rows="3"
        spellcheck="false"
        class="input w-full resize-none font-mono text-xs leading-relaxed"
        placeholder="{ }"
        @input="onJsonInput(($event.target as HTMLTextAreaElement).value)"
      />
      <p v-if="jsonError" class="text-[12px] text-danger">Invalid JSON: {{ jsonError }}</p>
    </template>
  </div>
</template>
