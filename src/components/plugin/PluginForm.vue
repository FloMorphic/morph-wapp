<script setup lang="ts">
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import { InflowForm } from '@inflowenger/plugin-form-builder'
import type { PluginForm } from '@/lib/pluginForm'

/**
 * The renderer for everything a plugin asks a user to fill in.
 *
 * A plugin describes its dialogs as JSON Schema + JSON Forms UI schema and
 * serves them on `@intro` / `@settings` (its onboarding profile) and on
 * `<action>.@form` (one action's parameters). Both arrive as documents at
 * runtime — nothing about them is known when FloMorphic is built — so they are
 * rendered by JSON Forms rather than by hand-written fields.
 *
 * `x-inflow-ui` is what makes those forms more than static inputs: a control
 * can carry a button that calls one of the plugin's own meta functions while
 * the form is open — fetch the projects this account can see, turn a typed name
 * into the accountId an API needs, validate a token. The plugin's answer is
 * then either patched into fields or, when it carries a schema, re-renders the
 * form as that new document, which is how a `<select>` gets options that did
 * not exist when the plugin was compiled.
 *
 * `x-inflow-notif` is the other half: what the form has to *say* — declared help
 * on a field, and what a lookup reported back. Those appear against the field
 * they are about; the ones addressed to no field, or to a field this schema no
 * longer renders, collect under the form and are themed below. Which of them
 * become toasts instead is decided once, in main.ts.
 *
 * **All of that lives in `@inflowenger/plugin-form-builder`, not here.** This
 * component used to re-implement the action (`pluginFn`), the request body, the
 * answer handling and the status line by hand; every host of the package was
 * doing the same, slightly differently. `<InflowForm>` owns the contract now,
 * and FloMorphic supplies only what is genuinely its own: the transport (in
 * main.ts), the widget set, and the look.
 *
 * `<InflowForm>` rather than a bare `<JsonForms>` is load-bearing. `<JsonForms>`
 * re-seeds its core from its props whenever `data` changes, so a schema a
 * plugin pushed in would be reverted by the next keystroke; `<InflowForm>` owns
 * schema/uischema/data above it, which is what makes a re-render stick.
 */
const props = defineProps<{
  form: PluginForm
  modelValue: Record<string, unknown>
  /**
   * The inflowv1 plugin this form came from. Optional only because a form can
   * be previewed without one; without it the `x-inflow-ui` buttons report that
   * they have no plugin to call rather than failing silently.
   */
  pluginId?: string
  /** The settings profile an action needs to reach the plugin's service
   *  (credentials, endpoint). Sent with every call as `settings`. */
  settings?: Record<string, unknown>
  readonly?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

/**
 * A plugin may answer a button with a whole new form. That is a live document,
 * not something to persist: what the node stores is the value the user ends up
 * with, and the form it was picked in is rebuilt from the plugin next time the
 * drawer opens. So the re-render is left to `<InflowForm>` and nothing is
 * written back to the node here.
 */
function onData(next: unknown) {
  emit('update:modelValue', next && typeof next === 'object' ? (next as Record<string, unknown>) : {})
}
</script>

<template>
  <div class="plugin-form">
    <InflowForm
      :schema="(props.form.schema as any)"
      :uischema="(props.form.uischema as any)"
      :data="props.modelValue"
      :renderers="vanillaRenderers"
      :plugin-id="props.pluginId"
      :settings="props.settings"
      :readonly="props.readonly"
      @update:data="onData"
    >
      <!-- Messages no field is showing — addressed to the form as a whole, or to
           a field a re-rendered schema dropped. They are not allowed to vanish
           with it, so they collect here. -->
      <template #notifications="{ notifications, dismiss }">
        <ul v-if="notifications.length" class="mt-1 flex list-none flex-col gap-1 p-0">
          <li
            v-for="n in notifications"
            :key="n.key"
            class="flex items-start justify-between gap-2 text-[11px] leading-snug"
            :class="{
              'text-danger': n.severity === 'error',
              'text-warning': n.severity === 'warning',
              'text-success': n.severity === 'success',
              'text-fg-subtle': n.severity === 'info' || n.severity === 'help',
            }"
          >
            <span class="min-w-0 whitespace-pre-line">
              <strong v-if="n.title" class="mr-1 font-semibold">{{ n.title }}</strong>{{ n.message }}
            </span>
            <button
              type="button"
              class="shrink-0 cursor-pointer border-0 bg-transparent px-1 leading-none text-current"
              :aria-label="`Dismiss: ${n.message}`"
              @click="dismiss(n.key)"
            >
              ×
            </button>
          </li>
        </ul>
      </template>

      <!-- The form's own line: what is in flight, and the failures the renderer
           raises itself (no plugin bound, a 502). A plugin's own report is a
           notification, not this. -->
      <template #status="{ busy, status, error }">
        <p v-if="busy" class="mt-1 text-[11px] text-fg-subtle">Asking the plugin…</p>
        <p v-else-if="error" class="mt-1 text-[11px] text-danger">{{ error }}</p>
        <p v-else-if="status" class="mt-1 text-[11px] text-fg-subtle">{{ status }}</p>
      </template>
    </InflowForm>
  </div>
</template>
