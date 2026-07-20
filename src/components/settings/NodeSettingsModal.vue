<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { NodeSetting } from '@/types/api'
import { nodeSettingsApi } from '@/api/nodeSettings'
import { nodeUniqLabel } from '@/lib/nodeSettings'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * Create / edit one settings profile. Shared by the Node Settings overview page
 * and the node drawer's selector. `settings` is edited as key/value rows; each
 * value is stored as JSON when it parses (numbers, booleans, objects) and as a
 * plain string otherwise — so simple tokens stay simple while richer config is
 * still expressible.
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

const form = reactive<{ id?: string; nodeUniqId: string; nodeType: string; title: string; rows: Row[] }>({
  id: undefined,
  nodeUniqId: '',
  nodeType: '',
  title: '',
  rows: [{ key: '', value: '' }],
})
const submitting = ref(false)
const formError = ref<string | null>(null)

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

// Re-seed the form whenever the modal opens.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    formError.value = null
    if (props.record) {
      form.id = props.record.id
      form.nodeUniqId = props.record.nodeUniqId
      form.nodeType = props.record.nodeType ?? props.nodeType ?? ''
      form.title = props.record.title
      form.rows = rowsFromSettings(props.record.settings)
    } else {
      form.id = undefined
      form.nodeUniqId = props.nodeUniqId ?? ''
      form.nodeType = props.nodeType ?? ''
      form.title = ''
      form.rows = [{ key: '', value: '' }]
    }
  },
  { immediate: true },
)

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
  const settings: Record<string, unknown> = {}
  for (const row of form.rows) {
    const key = row.key.trim()
    if (!key) continue
    settings[key] = parseValue(row.value)
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
    subtitle="A named key/value config reusable across every instance of this node."
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

      <div class="space-y-1.5">
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
