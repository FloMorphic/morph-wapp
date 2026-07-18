<script setup lang="ts">
import ComingSoon from '@/components/ui/ComingSoon.vue'

const points = [
  { icon: 'resources', label: 'Engine instances', text: 'Resources are the registered Inflow engine instances that actually execute compiled workflow graphs.' },
  { icon: 'refresh', label: 'Round-robin pool', text: 'The control plane loads instances into a pool and round-robins process requests across them.' },
  { icon: 'lock', label: 'Portals', text: 'Each instance carries its own config and JWT secret for authenticating REST calls to it.' },
  { icon: 'zap', label: 'Scalable execution', text: 'Add engine instances to scale horizontally without touching your workflow definitions.' },
]
</script>

<template>
  <ComingSoon
    title="Resources"
    subtitle="The Inflow engine instances registered with the control plane — the runtime capacity that walks and executes your compiled workflows."
    icon="resources"
    primitive="Engine Pool"
    :points="points"
  />
</template>
