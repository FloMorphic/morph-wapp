<script setup lang="ts">
import { computed } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import Icon from '@/components/ui/Icon.vue'
import NodeSettingsSelector from '@/components/flow/NodeSettingsSelector.vue'
import NodeConfig from '@/components/flow/NodeConfig.vue'
import { specForType, type BaseNodeData } from '@/data/nodeCatalog'
import { SETTINGS_DATA_KEYS, NODE_REF_DATA_KEYS } from '@/lib/nodeSettings'

// Kinds with a bespoke editor (NodeConfig). Their kind-specific data keys are
// managed there, so the generic field list drops to the universal fields only.
const CUSTOM_EDITOR_KINDS = new Set(['js', 'opa', 'rule', 'llm', 'goto'])

/**
 * Generic, catalog-driven property panel. It edits the selected node's `data`
 * in place (Vue Flow node data is reactive, so the canvas updates live). Fields
 * are inferred from the value type, with known long-text keys shown as code
 * areas — so every node kind is editable without a bespoke form.
 */
const props = defineProps<{ node: GraphNode | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'delete', node: GraphNode): void }>()

const spec = computed(() => (props.node ? specForType(props.node.type) : undefined))

const UNIVERSAL = ['title', 'key', 'scope']
const MULTILINE = new Set(['source', 'instructions', 'prompt', 'template', 'payload'])
// Managed by the settings selector / stamped from the backing extension row —
// not editable as generic fields.
const HIDDEN = new Set<string>([...SETTINGS_DATA_KEYS, ...NODE_REF_DATA_KEYS])

type FieldType = 'text' | 'number' | 'boolean' | 'code' | 'json'

interface Field {
  name: string
  label: string
  type: FieldType
}

function fieldType(name: string, value: unknown): FieldType {
  if (MULTILINE.has(name)) return 'code'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value !== null && typeof value === 'object') return 'json'
  return 'text'
}

function humanize(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

const isCustom = computed(() => !!props.node && CUSTOM_EDITOR_KINDS.has(props.node.type))

// Title / key / scope are edited inline on the node (see FlowNode) and shown
// here as a compact identity strip — so the drawer's height goes to the config.
const identityFields = computed<Field[]>(() =>
  UNIVERSAL.map((name) => ({ name, label: humanize(name), type: 'text' as FieldType })),
)

const fields = computed<Field[]>(() => {
  if (!props.node) return []
  const data = props.node.data as BaseNodeData
  // Bespoke-editor nodes manage their own kind-specific fields; universal
  // fields are handled by the identity strip above.
  const extra = isCustom.value
    ? []
    : Object.keys(data).filter((k) => !UNIVERSAL.includes(k) && !HIDDEN.has(k))
  return extra.map((name) => ({ name, label: humanize(name), type: fieldType(name, data[name]) }))
})

function data(): BaseNodeData {
  return props.node!.data as BaseNodeData
}

function jsonText(name: string): string {
  try {
    return JSON.stringify(data()[name] ?? null, null, 2)
  } catch {
    return ''
  }
}

function onJsonInput(name: string, raw: string) {
  try {
    data()[name] = JSON.parse(raw)
  } catch {
    /* keep last valid value until JSON parses */
  }
}
</script>

<template>
  <aside v-if="node && spec" class="flex w-[340px] shrink-0 flex-col border-l bg-surface">
    <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          :style="{ background: `color-mix(in srgb, ${spec.color} 16%, transparent)`, color: spec.color }"
        >
          <Icon :name="spec.icon" :size="16" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-fg">{{ spec.label }}</p>
          <p class="truncate text-[11px] text-fg-subtle">Compiles to {{ spec.primitives }}</p>
        </div>
      </div>
      <button class="text-fg-subtle hover:text-fg" title="Close" @click="emit('close')">
        <Icon name="x" :size="18" />
      </button>
    </div>

    <!-- Compact settings-profile picker, in the drawer head. -->
    <div v-if="node" class="border-b px-4 py-2">
      <NodeSettingsSelector :key="node.id" :node="node" />
    </div>

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <p class="text-xs leading-relaxed text-fg-muted">{{ spec.description }}</p>

      <!-- Identity strip: compact rows for title / key / scope. These are also
           editable inline on the node itself. -->
      <div class="space-y-1.5 rounded-lg border p-2.5">
        <div v-for="field in identityFields" :key="field.name" class="flex items-center gap-2">
          <label class="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            {{ field.label }}
          </label>
          <input
            v-model="(data() as any)[field.name]"
            class="input flex-1 px-2 py-1 text-xs"
            :placeholder="field.name === 'scope' ? '$' : ''"
          />
        </div>
      </div>

      <div v-for="field in fields" :key="field.name" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{{ field.label }}</label>

        <input
          v-if="field.type === 'text'"
          v-model="(data() as any)[field.name]"
          class="input"
          :placeholder="field.name === 'scope' ? '$' : ''"
        />
        <input
          v-else-if="field.type === 'number'"
          v-model.number="(data() as any)[field.name]"
          type="number"
          class="input"
        />
        <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm text-fg">
          <input v-model="(data() as any)[field.name]" type="checkbox" class="h-4 w-4 accent-[var(--accent)]" />
          <span>{{ (data() as any)[field.name] ? 'Enabled' : 'Disabled' }}</span>
        </label>
        <textarea
          v-else-if="field.type === 'code'"
          v-model="(data() as any)[field.name]"
          rows="5"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
        />
        <textarea
          v-else
          :value="jsonText(field.name)"
          rows="4"
          spellcheck="false"
          class="input resize-none font-mono text-xs leading-relaxed"
          @input="onJsonInput(field.name, ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <!-- Bespoke editor for code / rule / llm nodes. -->
      <div v-if="isCustom" class="border-t pt-4">
        <NodeConfig :key="node.id" :node="node" />
      </div>
    </div>

    <div class="border-t p-3">
      <button
        class="btn w-full text-danger"
        style="border: 1px solid var(--line-strong)"
        @click="emit('delete', node)"
      >
        <Icon name="trash" :size="15" />
        Delete node
      </button>
    </div>
  </aside>
</template>
