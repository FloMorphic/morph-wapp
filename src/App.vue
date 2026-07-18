<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

// Instantiating the store applies the persisted theme on first paint.
useUiStore()
</script>

<template>
  <RouterView />
</template>
