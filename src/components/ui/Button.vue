<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'outline' | 'ghost'
    icon?: string
    iconOnly?: boolean
    disabled?: boolean
    title?: string
    type?: 'button' | 'submit'
  }>(),
  { variant: 'outline', iconOnly: false, disabled: false, type: 'button' },
)

const cls = computed(() => ({
  'btn-primary': props.variant === 'primary',
  'btn-outline': props.variant === 'outline',
  'btn-ghost': props.variant === 'ghost',
  '!px-2': props.iconOnly,
}))
</script>

<template>
  <button class="btn" :class="cls" :type="type" :disabled="disabled" :title="title">
    <Icon v-if="icon" :name="icon" :size="16" />
    <slot />
  </button>
</template>
