<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'

/**
 * A block of generated text the user is meant to take elsewhere — a shell
 * one-liner, a dotenv, a script. Shows it verbatim in a scrollable pre with a
 * copy button, and optionally a download when the text belongs in a file.
 *
 * `secret` marks content that carries a credential: it is dimmed until revealed
 * so a plugin credential is not left sitting on screen during a screen share.
 */
const props = withDefaults(
  defineProps<{
    label: string
    content: string
    /** Offer a download, saved under this filename. */
    filename?: string
    /** Hide the body until the user asks for it (credential-bearing text). */
    secret?: boolean
    /** Max body height before it scrolls. */
    maxHeight?: string
  }>(),
  { secret: false, maxHeight: '14rem' },
)

const copied = ref(false)
const revealed = ref(!props.secret)

async function copy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

function download() {
  const url = URL.createObjectURL(new Blob([props.content], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = props.filename || 'download.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="rounded-lg border" style="border-color: var(--line-strong)">
    <div class="flex items-center justify-between gap-2 border-b px-3 py-1.5">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{{ label }}</span>
      <div class="flex items-center gap-3">
        <button v-if="secret" class="flex items-center gap-1 text-[12px] text-fg-muted hover:text-fg" @click="revealed = !revealed">
          <Icon :name="revealed ? 'lock' : 'scope'" :size="12" />
          {{ revealed ? 'Hide' : 'Reveal' }}
        </button>
        <button v-if="filename" class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="download">
          <Icon name="import" :size="12" />
          Download
        </button>
        <button class="flex items-center gap-1 text-[12px] text-accent hover:underline" @click="copy">
          <Icon :name="copied ? 'check' : 'copy'" :size="12" />
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <pre
      class="overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-muted transition-[filter]"
      :class="revealed ? '' : 'select-none blur-[3px]'"
      :style="{ maxHeight }"
      >{{ content }}</pre
    >
  </div>
</template>
