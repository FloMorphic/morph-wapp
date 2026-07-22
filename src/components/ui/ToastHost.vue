<script setup lang="ts">
import { useNotificationsStore, type NotificationLevel } from '@/stores/notifications'
import Icon from './Icon.vue'

/**
 * Renders the notification toast stack (see stores/notifications.ts).
 * Mounted once in App.vue so backend `notification` events and local API
 * action outcomes surface anywhere in the app.
 */

const store = useNotificationsStore()

const LEVEL_ICON: Record<NotificationLevel, string> = {
  success: 'check',
  error: 'alert-triangle',
  warning: 'alert-triangle',
  info: 'info',
}

function levelColor(level: NotificationLevel): string {
  switch (level) {
    case 'success':
      return 'var(--success)'
    case 'error':
      return 'var(--danger)'
    case 'warning':
      return 'var(--warning)'
    default:
      return 'var(--accent)'
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="card pointer-events-auto flex items-start gap-3 px-4 py-3"
          :style="{ borderLeft: `3px solid ${levelColor(toast.level)}`, boxShadow: 'var(--shadow-md)' }"
        >
          <span class="mt-0.5 shrink-0" :style="{ color: levelColor(toast.level) }">
            <Icon :name="LEVEL_ICON[toast.level]" :size="16" />
          </span>
          <div class="min-w-0 flex-1">
            <p v-if="toast.title" class="text-sm font-semibold text-fg">{{ toast.title }}</p>
            <p class="text-[13px] break-words text-fg-muted">{{ toast.message }}</p>
          </div>
          <button
            class="shrink-0 text-fg-subtle transition-colors hover:text-fg"
            title="Dismiss"
            @click="store.dismiss(toast.id)"
          >
            <Icon name="x" :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
