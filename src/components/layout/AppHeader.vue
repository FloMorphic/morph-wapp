<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import { flowsApi } from '@/api/flows'
import Icon from '@/components/ui/Icon.vue'
import Logo from '@/components/ui/Logo.vue'
import ThemeToggle from './ThemeToggle.vue'
import { APP_VERSION } from '@/version'

const ui = useUiStore()
const remote = flowsApi.isRemote()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center justify-between border-b bg-surface px-3">
    <div class="flex items-center gap-2">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
        title="Toggle sidebar"
        @click="ui.toggleSidebar()"
      >
        <Icon name="sidebar" :size="18" />
      </button>
      <RouterLink to="/workflows" class="flex items-center gap-2.5">
        <Logo :size="26" />
        <div class="leading-none">
          <span class="text-[15px] font-bold tracking-tight text-fg">FloMorphic</span>
          <span class="ml-1.5 hidden text-[11px] font-medium text-fg-subtle sm:inline">by Inflowenger</span>
        </div>
      </RouterLink>
    </div>

    <div class="flex items-center gap-2">
      <span
        class="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex"
        :class="remote ? 'text-success' : 'text-fg-muted'"
        :title="remote ? 'Connected to flomorphic-api' : 'Running standalone with local persistence'"
      >
        <span class="h-1.5 w-1.5 rounded-full" :style="{ background: remote ? 'var(--success)' : 'var(--fg-subtle)' }" />
        {{ remote ? 'Connected' : 'Local' }}
      </span>
      <ThemeToggle />
      <span class="chip hidden md:inline-flex">{{ APP_VERSION }}</span>
    </div>
  </header>
</template>
