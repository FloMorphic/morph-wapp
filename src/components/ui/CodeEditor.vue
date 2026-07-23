<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'

/**
 * CodeMirror 6 wrapper for JSON documents (context/header editing). Follows the
 * app theme: watches the `.dark` class on <html> (see stores/ui.ts) and swaps
 * between oneDark and a light theme built on the design-system tokens.
 */
const props = defineProps<{
  modelValue: string
  readonly?: boolean
  /** Soft-wrap long lines instead of horizontal scrolling. */
  wrap?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null
let observer: MutationObserver | null = null

const themeCompartment = new Compartment()
const wrapCompartment = new Compartment()

function wrapExtension() {
  return props.wrap ? EditorView.lineWrapping : []
}

/** Chrome shared by both themes, bound to the app's CSS variables. */
const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
    lineHeight: '1.6',
  },
  '&.cm-focused': { outline: 'none' },
})

const lightTheme = EditorView.theme(
  {
    '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--fg-subtle)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--accent-soft)',
    },
  },
  { dark: false },
)

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function themeExtension() {
  return isDark() ? oneDark : lightTheme
}

onMounted(() => {
  if (!editorRef.value) return
  view = new EditorView({
    doc: props.modelValue || '',
    extensions: [
      basicSetup,
      json(),
      baseTheme,
      themeCompartment.of(themeExtension()),
      wrapCompartment.of(wrapExtension()),
      EditorState.readOnly.of(!!props.readonly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && view) emit('update:modelValue', view.state.doc.toString())
      }),
    ],
    parent: editorRef.value,
  })

  // Follow app theme switches (manual toggle or OS change) live.
  observer = new MutationObserver(() => {
    view?.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) })
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

watch(
  () => props.wrap,
  () => view?.dispatch({ effects: wrapCompartment.reconfigure(wrapExtension()) }),
)

// External writes (e.g. re-fetch after save) — sync without clobbering typing.
watch(
  () => props.modelValue,
  (newVal) => {
    if (view && newVal !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newVal || '' } })
    }
  },
)

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="editorRef" class="code-editor h-full min-h-0 overflow-hidden" />
</template>

<style scoped>
.code-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
