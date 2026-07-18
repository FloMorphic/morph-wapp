<script setup lang="ts">
import ComingSoon from '@/components/ui/ComingSoon.vue'

const points = [
  { icon: 'node-plugin', label: 'Live processes', text: 'A plugin is a live external process you own — its own connections, state and job lifecycle, called over NATS.' },
  { icon: 'extensions', label: 'Plugin store', text: 'Publish, add and remove plugins across products; each appears as a ready-made node in the canvas palette.' },
  { icon: 'settings', label: 'Self-describing UI', text: 'Every action ships a JSON-Schema / UI-Schema form, rendered natively — no bespoke UI per integration.' },
  { icon: 'node-extrinsic', label: 'Extrinsics', text: 'Thin, internal domain logic exposed as NATS subjects — one request in, one response out.' },
  { icon: 'lock', label: 'Scoped credentials', text: 'Each plugin instance is scoped to its own subject prefix, so one cannot observe another’s traffic.' },
  { icon: 'node-http', label: 'Connect anything', text: 'REST, databases, queues, webhooks, event streams, cloud services, AI providers and private MCP servers.' },
]
</script>

<template>
  <ComingSoon
    title="Plugins"
    subtitle="The InflowV1 extension surface. Plugins and extrinsics connect FloMorphic to the outside world — a single plugin can back an entire automation system."
    icon="plugin"
    primitive="InflowV1 Protocol"
    :points="points"
  />
</template>
