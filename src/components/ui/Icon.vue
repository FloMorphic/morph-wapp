<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { Icon as IconifyIcon } from '@iconify/vue'
import { icons } from '@/lib/icons'
import { ensureMdi, mdiReady } from '@/lib/mdiIcons'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    strokeWidth?: number
  }>(),
  { size: 18, strokeWidth: 2 },
)

/**
 * An Iconify-style name is a plugin-supplied icon from the bundled MDI
 * collection: either the canonical `mdi:database` or the `mdi-database` hyphen
 * form some descriptors use. Anything else is one of our curated local names
 * (`lib/icons`), rendered as before.
 */
const iconifyName = computed(() => {
  const n = props.name?.trim() ?? ''
  if (n.includes(':')) return n
  if (n.startsWith('mdi-')) return `mdi:${n.slice(4)}`
  return null
})

// Pull the MDI chunk in the moment a plugin icon is asked for; `mdiReady` then
// flips and this component re-renders into the Iconify branch.
watchEffect(() => {
  if (iconifyName.value) ensureMdi()
})

const inner = computed(() => icons[props.name] ?? icons['info'])
const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <!-- Plugin (MDI) icon: fill-based, drawn by Iconify from the bundled set.
       Until the collection loads we fall through to the local svg below, so the
       slot is never empty. -->
  <IconifyIcon v-if="iconifyName && mdiReady" :icon="iconifyName" :width="px" :height="px" />
  <svg
    v-else
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>
