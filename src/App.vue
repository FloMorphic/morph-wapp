<script setup lang="ts">
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useFlowLogsStore } from '@/stores/flowLogs'
import ToastHost from '@/components/ui/ToastHost.vue'

// Instantiating the store applies the persisted theme on first paint.
useUiStore()

// Keep the runtime socket up for the whole app session so `notification`
// events (scheduler launches, action outcomes) surface as toasts on any view,
// not just while the workflow editor is open.
const logs = useFlowLogsStore()
onMounted(() => {
  if (logs.isRemote) logs.connect()
})
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
