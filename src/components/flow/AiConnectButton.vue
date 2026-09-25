<script setup lang="ts">
import { ref } from 'vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import AiConnectDialog from './AiConnectDialog.vue'

/**
 * Toolbar entry for the "use FloMorphic with an AI" help, sitting beside AI
 * build — the two AI entry points read as a pair.
 *
 * It owns the dialog rather than emitting upward, the same shape as
 * AiNodeImporter and WorkflowImporter: the dialog is self-contained read-only
 * help with no state the editor needs, so an event threaded through the view
 * would buy nothing.
 */
const open = ref(false)
</script>

<template>
  <ToolButton
    icon="mdi:assistant"
    label="AI connect"
    :active="open"
    title="Use FloMorphic with an AI — point Claude, Codex or Cursor at this install's MCP server"
    @click="open = true"
  />

  <AiConnectDialog :open="open" @close="open = false" />
</template>
