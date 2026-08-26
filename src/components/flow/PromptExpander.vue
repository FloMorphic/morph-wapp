<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Button from '@/components/ui/Button.vue'

/**
 * "Expand" affordance for a node's prompt box — sits beside the Import button in
 * the LLM / MCP drawers' message headers. The drawer's textarea is deliberately
 * small, but init prompts are often long; clicking this opens the same text in a
 * roomy dialog so it can be read and edited comfortably.
 *
 * It edits the bound box directly (v-model), so keystrokes in the dialog and the
 * small textarea stay in sync live — closing the dialog just hides the larger
 * editing surface, it doesn't commit or discard anything.
 */
const props = defineProps<{
  /** The prompt box's current text. */
  modelValue: string
  /** Which box is being expanded — shown in the dialog subtitle. */
  label?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)

const text = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emit('update:modelValue', v),
})
</script>

<template>
  <button
    class="flex items-center gap-1 text-[12px] text-accent hover:underline"
    title="Edit this prompt in a larger dialog"
    @click="open = true"
  >
    <Icon name="maximize" :size="13" /> Expand
  </button>

  <Modal
    :open="open"
    size="lg"
    title="Edit prompt"
    :subtitle="label ? `The ${label} message. Changes sync live with the drawer.` : 'Changes sync live with the drawer.'"
    @close="open = false"
  >
    <textarea
      v-model="text"
      rows="18"
      spellcheck="false"
      class="input resize-y font-mono text-xs leading-relaxed"
      placeholder="Write the prompt here…"
    />

    <template #footer>
      <Button @click="open = false">Close</Button>
    </template>
  </Modal>
</template>
