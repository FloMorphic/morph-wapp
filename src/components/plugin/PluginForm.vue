<script setup lang="ts">
import { computed } from 'vue'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import { InflowForm } from '@inflowenger/plugin-form-builder'
import {
  InflowSandboxForm,
  resolveRenderer,
  type GuestNotification,
} from '@inflowenger/plugin-sandbox'
import { nodeRegistryApi } from '@/api/nodeRegistry'
import { useNotificationsStore, type NotificationLevel } from '@/stores/notifications'
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
 *
 * ## When the dialog is not a form
 *
 * Some dialogs cannot be said in JSON Schema — a query builder, a diff, a table
 * of rows to pick from, anything that draws. Expressing those declaratively
 * means inventing a widget vocabulary for each one and shipping it *here*,
 * which puts FloMorphic on the critical path of every plugin's UI.
 *
 * So a form document may name a `renderer`, and when it names a code one the
 * plugin's own module is run in a sandbox — a Web Worker whose output is
 * mirrored into this document as ordinary host nodes, or a null-origin frame.
 * All of that lives in `@inflowenger/plugin-sandbox`; what this component
 * supplies is the same three things it supplies the declarative renderer: the
 * transport, the look, and somewhere to put the messages.
 *
 * Two properties of that arrangement are worth stating because they are what
 * make it acceptable to run a third party's code in our drawer at all:
 *
 *  - **The settings profile crosses only when the form explicitly asks.** The
 *    sandbox passes it to the guest only for `renderer.exposeSettings: true`;
 *    otherwise a guest reaches its service through `call` below, where *we*
 *    attach the credentials. It can use a token it is never handed.
 *  - **A failed renderer is not a failed node.** Every plugin ships its
 *    declarative form alongside, and the `fallback` slot draws it. A blocked
 *    CDN, a browser without Workers or a plugin's own bug degrades the dialog,
 *    never the ability to configure the node.
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
  /** The action or `@settings` being configured; labels the sandbox and is
   *  handed to a guest that was explicitly allowed to see it. */
  method?: string
  readonly?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

/**
 * Which engine this document asked for.
 *
 * Resolved by the sandbox package rather than read here, because "absent",
 * "unknown" and "malformed" all have to mean the same safe thing — the
 * declarative renderer — and that decision belongs in one place.
 */
const renderer = computed(() => resolveRenderer(props.form.renderer as never))

const notifications = useNotificationsStore()

/**
 * The guest's only way out.
 *
 * Deliberately the same transport `x-inflow-ui`'s `pluginFn` action uses, so a
 * plugin's meta functions serve both renderers unchanged and a dialog can be
 * rewritten from one to the other without touching the backend. The settings
 * profile is attached here, in our realm — the guest supplies the method name
 * and a body, and never sees the credentials the call is made with.
 */
async function callPlugin(fn: string, body?: Record<string, unknown>) {
  if (!props.pluginId) throw new Error('this form is not bound to a plugin')
  return nodeRegistryApi.pluginFn(props.pluginId, fn, {
    ...(body ?? {}),
    settings: props.settings ?? {},
  })
}

/**
 * A guest's message → somewhere the user will see it.
 *
 * The same policy main.ts applies to the declarative renderer's messages:
 * only the ones that asked to be a toast or a dialog become one. The
 * difference is where the rest go. A declarative form has a *field* to put an
 * inline message under, because the host drew that field; a sandboxed guest
 * drew its own, and the host has no idea which node "the collection field"
 * refers to.
 *
 * So anything not claimed as a toast is raised as one anyway, at a quieter
 * level. That is a deliberate trade: slightly noisier than ideal, and never
 * the alternative, which is a plugin's only explanation of what went wrong
 * being addressed to a field nobody can find and therefore dropped.
 */
const GUEST_TOAST_LEVEL: Record<string, NotificationLevel> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
  help: 'info',
}

function onGuestNotification(notification: GuestNotification | string) {
  const value = typeof notification === 'string' ? { message: notification } : notification
  if (!value.message) return

  notifications.notify({
    level: GUEST_TOAST_LEVEL[value.severity ?? 'info'] ?? 'info',
    title: value.title,
    message: value.message,
  })
}

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
    <!--
      A plugin that ships code gets to draw its own dialog. The sandbox package
      withholds `settings` unless the form asked for it with
      `renderer.exposeSettings: true`; calls always carry it.
    -->
    <InflowSandboxForm
      v-if="renderer.type !== 'jsonforms'"
      :renderer="(props.form.renderer as any)"
      :schema="props.form.schema"
      :uischema="props.form.uischema"
      :data="props.modelValue"
      :plugin-id="props.pluginId"
      :method="props.method"
      :settings="props.settings"
      :readonly="props.readonly"
      :call="callPlugin"
      @update:data="onData"
      @notification="onGuestNotification"
    >
      <template #loading>
        <p class="mt-1 text-[11px] text-fg-subtle">Loading the plugin's interface…</p>
      </template>

      <!--
        The contract this host owes a plugin: when its renderer will not run,
        the declarative form it also shipped is drawn instead. A node must not
        become unconfigurable because a bundle failed to load.
      -->
      <template #fallback="{ error }">
        <p class="mt-1 mb-2 text-[11px] text-warning">
          This plugin's own interface could not be loaded, so its standard form is shown instead.
          <span class="block text-fg-subtle">{{ error }}</span>
        </p>
        <InflowForm
          :schema="(props.form.schema as any)"
          :uischema="(props.form.uischema as any)"
          :data="props.modelValue"
          :renderers="vanillaRenderers"
          :plugin-id="props.pluginId"
          :settings="props.settings"
          :readonly="props.readonly"
          @update:data="onData"
        />
      </template>
    </InflowSandboxForm>

    <InflowForm
      v-else
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
