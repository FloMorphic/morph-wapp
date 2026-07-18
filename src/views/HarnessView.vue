<script setup lang="ts">
import ComingSoon from '@/components/ui/ComingSoon.vue'

const points = [
  { icon: 'node-model', label: 'Models', text: 'Register model providers and expose them as a stable execution layer, decoupled from any one vendor.' },
  { icon: 'node-tool', label: 'Tools', text: 'Define tool schemas agents can invoke — each backed by a plugin or extrinsic node.' },
  { icon: 'node-memory', label: 'Memory', text: 'Wire conversation and vector memory the harness can read and write during a run.' },
  { icon: 'node-guardrail', label: 'Governance', text: 'Validation, moderation and policy — AI as a governed capability, not the architecture.' },
  { icon: 'node-loop', label: 'Loop systems', text: 'Reason through iteration: planning, self-review and approval cycles until success conditions hold.' },
  { icon: 'zap', label: 'Observability', text: 'Trace every model call, tool invocation and context mutation as a run unfolds.' },
]
</script>

<template>
  <ComingSoon
    title="AI Harness"
    subtitle="A controlled environment for models, tools, memory and reasoning — a stable execution layer for intelligent systems, so apps aren't tightly coupled to any AI provider."
    icon="harness"
    primitive="Plugin · Loop"
    :points="points"
  />
</template>
