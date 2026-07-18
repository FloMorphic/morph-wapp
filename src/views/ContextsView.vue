<script setup lang="ts">
import ComingSoon from '@/components/ui/ComingSoon.vue'

const points = [
  { icon: 'node-memory', label: 'Living state', text: 'A Context is a JSON document holding everything a process needs — it evolves as nodes read and write it.' },
  { icon: 'node-transform', label: 'Scoped access', text: 'Each node touches only a JSONPath slice (its scope) and writes output to a key, keeping mutations explicit.' },
  { icon: 'workflow', label: 'The memory', text: 'Context is the memory, workflows are the logic, fractals are the processors — computation over shared state.' },
  { icon: 'refresh', label: 'Replayable', text: 'Because logic is externalized into the graph, a run’s context is inspectable and traceable end to end.' },
]
</script>

<template>
  <ComingSoon
    title="Contexts"
    subtitle="Contexts are the living state that flows through a workflow — the primary unit of computation in the Inflowenger runtime."
    icon="context"
    primitive="Context Document"
    :points="points"
  />
</template>
