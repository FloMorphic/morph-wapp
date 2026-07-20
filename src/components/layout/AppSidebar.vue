<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import Icon from '@/components/ui/Icon.vue'

const route = useRoute()
const ui = useUiStore()

interface NavItem {
  to: string
  label: string
  icon: string
  section: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: 'Build',
    items: [
      { to: '/workflows', label: 'Workflows', icon: 'workflow', section: 'workflows' },
      { to: '/extensions', label: 'Extensions', icon: 'extensions', section: 'extensions' },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/memory', label: 'Memory', icon: 'memory', section: 'memory' },
      { to: '/contexts', label: 'Contexts', icon: 'context', section: 'contexts' },
      { to: '/prompts', label: 'Prompts', icon: 'prompt', section: 'prompts' },
    ],
  },
  {
    label: 'Operate',
    items: [{ to: '/human-tasks', label: 'Human Task', icon: 'node-human', section: 'human-tasks' }],
  },
]

const activeSection = computed(() => route.meta.section as string | undefined)
const collapsed = computed(() => ui.sidebarCollapsed)
</script>

<template>
  <aside
    class="flex shrink-0 flex-col border-r bg-surface transition-[width] duration-200"
    :class="collapsed ? 'w-[60px]' : 'w-[224px]'"
  >
    <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
      <div v-for="group in groups" :key="group.label" class="mb-4">
        <p
          v-if="!collapsed"
          class="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle"
        >
          {{ group.label }}
        </p>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          :title="item.label"
          class="mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
          :class="{ 'is-active': activeSection === item.section, 'justify-center': collapsed }"
        >
          <Icon :name="item.icon" :size="18" />
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="border-t p-2.5">
      <RouterLink
        to="/settings"
        title="Settings"
        class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg"
        :class="{ 'is-active': activeSection === 'settings', 'justify-center': collapsed }"
      >
        <Icon name="settings" :size="18" />
        <span v-if="!collapsed">Settings</span>
      </RouterLink>
    </div>
  </aside>
</template>

<style scoped>
.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}
.is-active:hover {
  color: var(--accent);
}
</style>
