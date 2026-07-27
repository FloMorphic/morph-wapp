<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * A toolbar button for the workflow editor's top bar: icon stacked over a small
 * caption, so ten of them read as a row of tools rather than a wall of pills.
 *
 * `active` is for toggles that stay on (minimap, log drawer) — it tints the
 * button the way hover does, so an enabled tool is visible without reading the
 * label. `badge` rides in the top-right corner for counts (live runs, errors).
 */
withDefaults(
  defineProps<{
    icon: string
    label: string
    /** `primary` fills with the accent (Run / Save); `default` is quiet chrome. */
    tone?: 'default' | 'primary'
    /** Toggle is currently on. */
    active?: boolean
    disabled?: boolean
    title?: string
    badge?: string | number
    badgeTone?: 'info' | 'danger'
  }>(),
  { tone: 'default', active: false, disabled: false, badgeTone: 'info' },
)
</script>

<template>
  <button
    class="tool-btn"
    :class="[tone === 'primary' ? 'tool-btn--primary' : 'tool-btn--quiet', { 'is-active': active }]"
    type="button"
    :disabled="disabled"
    :title="title ?? label"
  >
    <Icon :name="icon" :size="17" class="tool-btn__icon" />
    <span class="tool-btn__label">{{ label }}</span>
    <span v-if="badge" class="tool-btn__badge" :class="`tool-btn__badge--${badgeTone}`">{{ badge }}</span>
  </button>
</template>
