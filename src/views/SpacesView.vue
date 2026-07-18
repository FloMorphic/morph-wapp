<script setup lang="ts">
import ComingSoon from '@/components/ui/ComingSoon.vue'

const points = [
  { icon: 'spaces', label: 'NATS accounts', text: 'Spaces model multi-tenancy as scoped NATS accounts rather than plain database rows.' },
  { icon: 'lock', label: 'Strict isolation', text: 'Each plugin instance gets credentials scoped to a unique subject prefix — no cross-tenant traffic.' },
  { icon: 'node-extrinsic', label: 'Coordination', text: 'Actors coordinate over NATS request/reply, so one engine can serve many backends without a shared DB.' },
  { icon: 'settings', label: 'Credentials', text: 'Mint and manage the sys / inflow / plugins accounts that scope every runtime interaction.' },
]
</script>

<template>
  <ComingSoon
    title="Spaces"
    subtitle="The multi-tenancy and isolation layer — scoped NATS credentials that let a single runtime safely serve many products and tenants."
    icon="spaces"
    primitive="NATS Accounts"
    :points="points"
  />
</template>
