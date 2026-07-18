<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import Icon from '@/components/ui/Icon.vue'

const ui = useUiStore()
const iconName = computed(() => (ui.theme === 'light' ? 'sun' : ui.theme === 'dark' ? 'moon' : 'monitor'))
const label = computed(() => `Theme: ${ui.theme}`)
</script>

<template>
  <button
    class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
    :title="label"
    @click="ui.cycleTheme()"
  >
    <Icon :name="iconName" :size="17" />
  </button>
</template>
