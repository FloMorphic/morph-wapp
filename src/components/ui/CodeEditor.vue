<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { placeholder as cmPlaceholder } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { languageFor, type EditorLanguage } from './codeLanguages'

/**
 * CodeMirror 6 wrapper for code documents — JSON (context/header editing),
 * JavaScript and OPA/Rego (node code editors). Follows the app theme: watches
 * the `.dark` class on <html> (see stores/ui.ts) and swaps between oneDark and
 * a light theme built on the design-system tokens. basicSetup provides the
 * assistant chrome (autocompletion, brackets, search); each language module
 * contributes its own completion sources.
 */
const props = defineProps<{
  modelValue: string
  /** Syntax + completions to load. Defaults to JSON (the original use case). */
  language?: EditorLanguage
  readonly?: boolean
  /** Soft-wrap long lines instead of horizontal scrolling. */
  wrap?: boolean
  /** Ghost text shown while the document is empty. */
  placeholder?: string
  /**
   * Render as a bordered form field that auto-grows with content (bounded,
   * then scrolls) instead of filling the parent's height.
   */
  inline?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null
let observer: MutationObserver | null = null

const themeCompartment = new Compartment()
const wrapCompartment = new Compartment()
const languageCompartment = new Compartment()

function wrapExtension() {
  return props.wrap ? EditorView.lineWrapping : []
}

/** Chrome shared by both themes, bound to the app's CSS variables. */
const baseTheme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
    lineHeight: '1.6',
  },
  '&.cm-focused': { outline: 'none' },
})

// Block mode fills the parent; inline mode behaves like a textarea form field:
// grows with content up to a cap, then scrolls internally.
const sizeTheme = EditorView.theme(
  props.inline
    ? { '&': { minHeight: '7.5rem', maxHeight: '20rem' }, '.cm-scroller': { overflow: 'auto' } }
    : { '&': { height: '100%' } },
)

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
      languageCompartment.of(languageFor(props.language ?? 'json')),
      baseTheme,
      sizeTheme,
      themeCompartment.of(themeExtension()),
      wrapCompartment.of(wrapExtension()),
      props.placeholder ? cmPlaceholder(props.placeholder) : [],
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

// Live language switches (e.g. the Rule node's JS ↔ OPA toggle).
watch(
  () => props.language,
  (lang) => view?.dispatch({ effects: languageCompartment.reconfigure(languageFor(lang ?? 'json')) }),
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
  <div
    ref="editorRef"
    class="code-editor overflow-hidden"
    :class="inline ? 'code-editor--inline rounded-lg border' : 'h-full min-h-0'"
  />
</template>

<style scoped>
.code-editor:not(.code-editor--inline) :deep(.cm-editor) {
  height: 100%;
}
.code-editor--inline:focus-within {
  border-color: var(--accent);
}
</style>
