<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    /** Dialog width. 'md' (default) suits a form; 'lg' a two-column workspace. */
    size?: 'md' | 'lg'
    /**
     * Allow dismissing by clicking the backdrop or pressing Escape. Default true.
     * Set false for dialogs holding unsaved input (e.g. a form with added fields)
     * so a stray outside click can't discard the work — only the close/action
     * buttons dismiss it.
     */
    dismissible?: boolean
  }>(),
  { size: 'md', dismissible: true },
)
const emit = defineEmits<{ (e: 'close'): void }>()

function onBackdrop() {
  if (props.dismissible) emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && props.dismissible) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh] backdrop-blur-sm"
        @click.self="onBackdrop"
      >
        <div
          class="card w-full"
          :class="size === 'lg' ? 'max-w-3xl' : 'max-w-lg'"
          style="box-shadow: var(--shadow-lg)"
          @click.stop
        >
          <div class="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <h2 class="text-base font-semibold text-fg">{{ title }}</h2>
              <p v-if="subtitle" class="mt-0.5 text-[13px] text-fg-muted">{{ subtitle }}</p>
            </div>
            <button class="text-fg-subtle hover:text-fg" title="Close" @click="emit('close')">
              <Icon name="x" :size="18" />
            </button>
          </div>
          <div class="px-5 py-4"><slot /></div>
          <div v-if="$slots.footer" class="flex justify-end gap-2 border-t px-5 py-3">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
