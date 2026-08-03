import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { mergeStyles, defaultStyles } from '@jsonforms/vue-vanilla'
import { InflowUiPlugin, createInflowUi } from '@inflowenger/plugin-form-builder'
import App from './App.vue'
import router from './router'
import { nodeRegistryApi } from '@/api/nodeRegistry'

// Base styles + design tokens (Tailwind v4)
import './style.css'

// Vue Flow core + add-on styles (canvas, controls, minimap)
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

// JSON Forms (vanilla widgets) + the x-inflow-ui decorations, for the forms
// plugins ship at runtime. All three are structural only; the look is ours
// (below). vanilla-fixes is the optional third: the layout repairs vanilla's
// own renderers need — empty validation rows, checkboxes, the array fieldset
// and its rows — which every host of the package would otherwise re-derive.
// Importing it is how we say we use that renderer set.
import '@jsonforms/vue-vanilla/vanilla.css'
import '@inflowenger/plugin-form-builder/style.css'
import '@inflowenger/plugin-form-builder/vanilla-fixes.css'

// FloMorphic Vue Flow overrides (themed to design tokens)
import './assets/vue-flow.css'

const app = createApp(App)

/**
 * Theme the plugin form renderer.
 *
 * A plugin's form is drawn by JSON Forms from a schema we have never seen, so
 * it cannot be styled per field — instead the widget set is told which class
 * names to emit, and those classes are defined in style.css against the same
 * design tokens as the rest of the app. That is what keeps a third-party form
 * looking like FloMorphic in both light and dark mode, while
 * plugin-form-builder stays design-system-agnostic.
 *
 * `mergeStyles` keeps vanilla's structural classes (the array-list machinery
 * relies on them) and appends ours.
 */
app.provide(
  'styles',
  mergeStyles(defaultStyles, {
    control: {
      root: 'if-control',
      label: 'if-label',
      input: 'if-input',
      select: 'if-input',
      textarea: 'if-input',
      error: 'if-error',
      description: 'if-desc',
    },
    verticalLayout: { root: 'if-vstack' },
    horizontalLayout: { root: 'if-hstack', item: 'if-hstack-item' },
    group: { root: 'if-group', label: 'if-group-label' },
    arrayList: { root: 'if-array', addButton: 'if-btn', label: 'if-group-label' },
    // The "clear data?" confirm shown when a oneOf is switched with data in it
    // is a native <dialog> baked into vanilla's OneOfRenderer — it can only be
    // styled, not turned off, so it is themed to match.
    dialog: {
      root: 'if-dialog',
      title: 'if-dialog-title',
      body: 'if-dialog-body',
      actions: 'if-dialog-actions',
      buttonPrimary: 'if-btn',
      buttonSecondary: 'if-btn-secondary',
    },
  }),
)

// The x-inflow-ui button look, and the one thing a host has to supply: how to
// reach a plugin's meta functions.
//
// The action itself — `pluginFn`, the name every plugin writes in its UI schema
// — ships inside plugin-form-builder, together with the whole contract around
// it: the flat request body, and applying the answer by shape (a patch of
// fields, or a whole new form). So all that belongs here is transport. Which
// plugin a call addresses and which settings profile it carries are per form,
// passed by components/plugin/PluginForm.
app.use(
  InflowUiPlugin,
  createInflowUi({
    theme: { containerClass: 'if-inflow-field', buttonClass: 'if-btn', iconButtonClass: 'if-btn-icon' },
    call: ({ pluginId, fn, body }) => nodeRegistryApi.pluginFn(pluginId, fn, body),
  }),
)

app.use(createPinia()).use(router).mount('#app')
