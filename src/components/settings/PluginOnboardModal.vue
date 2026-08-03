<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import PluginForm from '@/components/plugin/PluginForm.vue'
import { nodeSettingsApi } from '@/api/nodeSettings'
import type { ExtensionRecord, PluginIntro } from '@/types/api'
import { nodeUniqId } from '@/lib/nodeSettings'
import { toPluginForm, withSchemaDefaults } from '@/lib/pluginForm'

/**
 * A plugin's onboarding: turn the settings form it advertises on `@intro` into
 * a reusable settings profile.
 *
 * The SDK calls this form "requirement data before any action" — the credentials
 * and endpoints a plugin needs filled in before any of its nodes can do
 * anything. It is fetched live and never stored: the plugin is the authority on
 * what it needs, and it can change between deploys. What *is* stored is the
 * profile the user fills in, under the plugin's identity (`ext:<pluginId>`), so
 * every node of that plugin can pick it in its drawer.
 *
 * A plugin that advertises no settings form has nothing to onboard — it is told
 * so rather than shown an empty form.
 */
const props = defineProps<{
  open: boolean
  plugin: ExtensionRecord | null
  intro: PluginIntro | null
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', title: string): void }>()

/**
 * The form the plugin asked for — schema *and* UI schema, both JSON documents
 * the SDK carries as strings.
 *
 * Rendering the UI schema too is the point: it is where the plugin says how it
 * wants to be asked (field order, groups, a textarea here, and the `x-inflow-ui`
 * buttons that let a field call back into the plugin while it is being filled
 * in). Dropping it would leave the plugin only able to describe its data, not
 * its dialog — so this goes through the same runtime renderer the Inflow
 * inspector uses rather than a hand-written field list.
 */
const form = computed(() => toPluginForm(props.intro?.settings))
const hasFields = computed(() => !!form.value)

const title = ref('')
const values = ref<Record<string, unknown>>({})
const saving = ref(false)
const error = ref<string | null>(null)

/**
 * Free-form fallback for when no form could be read.
 *
 * A plugin advertises its requirements on `@intro` or `@settings`, and neither
 * is guaranteed to arrive: it may genuinely declare none, or its SDK may not
 * serve them (the Go SDK through v0.1.3 answers neither — `@intro` marshals a
 * method, and `@settings` trips over an un-excluded func field). Those cases are
 * indistinguishable from here, and in the second one the user does know what the
 * plugin needs. So rather than refuse, offer plain key/value pairs — the profile
 * that comes out is the same shape either way.
 */
const manual = ref<{ key: string; value: string }[]>([{ key: '', value: '' }])

function addRow() {
  manual.value.push({ key: '', value: '' })
}
function removeRow(i: number) {
  manual.value.splice(i, 1)
}

/** The values to save: the rendered form's, or the manual rows'. */
function collect(): Record<string, unknown> {
  if (hasFields.value) return (values.value ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const row of manual.value) {
    const key = row.key.trim()
    if (key) out[key] = row.value
  }
  return out
}

// Reset whenever a different plugin is onboarded. The form starts on whatever
// defaults its schema declares — JSON Forms only materialises those once a
// control is touched, and a plugin means them (`"deployment": "cloud"`).
watch(
  () => [props.open, props.plugin?.id, form.value],
  () => {
    if (!props.open) return
    title.value = props.plugin ? `${props.plugin.name} default` : ''
    values.value = withSchemaDefaults(form.value?.schema, {})
    manual.value = [{ key: '', value: '' }]
    error.value = null
  },
)

async function save() {
  if (!props.plugin) return
  const name = title.value.trim()
  if (!name) {
    error.value = 'Give the profile a name.'
    return
  }
  saving.value = true
  error.value = null
  try {
    await nodeSettingsApi.save({
      // Keyed by plugin identity, so every node this plugin contributes shares
      // the profile — the same bucket the node drawer's selector reads.
      nodeUniqId: nodeUniqId('plugin', { pluginId: props.plugin.pluginId }),
      nodeType: 'plugin',
      title: name,
      settings: collect(),
    })
    emit('saved', name)
    emit('close')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    :title="plugin ? `Set up ${plugin.name}` : 'Set up plugin'"
    subtitle="The settings this plugin asks for, saved as a profile its nodes can use."
    @close="emit('close')"
  >
    <div v-if="!intro" class="py-8 text-center text-sm text-fg-muted">Reading the plugin's requirements…</div>

    <div v-else class="space-y-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface-2 px-3 py-2 text-[12px]">
        <span class="font-medium text-fg">{{ intro.name || plugin?.name }}</span>
        <span v-if="intro.version" class="chip !bg-surface !text-fg-subtle font-mono text-[10px]">{{ intro.version }}</span>
        <span v-if="intro.author" class="text-fg-subtle">by {{ intro.author }}</span>
      </div>

      <div class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Profile name</label>
        <input v-model="title" class="input" placeholder="e.g. Production" />
      </div>

      <!-- The plugin advertised a form: render exactly what it asked for. -->
      <div v-if="hasFields" class="space-y-1">
        <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Plugin settings</label>
        <PluginForm :form="form!" v-model="values" :plugin-id="plugin?.pluginId" :settings="values" />
      </div>

      <!-- It didn't. Either it needs nothing, or it couldn't tell us — both look
           the same from here, so say so and let the values be entered by hand. -->
      <template v-else>
        <div class="rounded-lg border border-dashed px-3 py-2.5 text-[12px] text-fg-muted">
          This plugin didn't return a settings form. It may need none — or it may not serve one:
          <code class="font-mono">@intro</code> and <code class="font-mono">@settings</code> go unanswered on Go SDK
          v0.1.3 and earlier. Enter what it needs below, or close if it needs nothing.
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Settings</label>
            <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="addRow">
              <Icon name="plus" :size="13" /> Add
            </button>
          </div>
          <div v-for="(row, i) in manual" :key="i" class="flex items-center gap-2">
            <input v-model="row.key" class="input flex-1 font-mono text-xs" placeholder="key" />
            <input v-model="row.value" class="input flex-1 font-mono text-xs" placeholder="value" />
            <button
              class="shrink-0 rounded-lg p-1.5 text-fg-subtle hover:bg-danger-soft hover:text-danger"
              @click="removeRow(i)"
            >
              <Icon name="x" :size="15" />
            </button>
          </div>
        </div>
      </template>

      <p class="flex items-start gap-2 text-[11px] text-fg-subtle">
        <span class="mt-0.5"><Icon name="info" :size="12" /></span>
        <span>
          Saved against <code class="font-mono">{{ plugin?.pluginId }}</code
          >, so every node this plugin contributes can select it. Add more profiles for other environments.
        </span>
      </p>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <Button @click="emit('close')">Cancel</Button>
      <Button variant="primary" icon="save" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save profile' }}
      </Button>
    </template>
  </Modal>
</template>
