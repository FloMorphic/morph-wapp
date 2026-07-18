import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { readValue, writeValue } from '@/lib/localStore'

export type ThemePreference = 'light' | 'dark' | 'system'

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function applyTheme(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemePreference>(readValue<ThemePreference>('theme', 'system'))
  const sidebarCollapsed = ref<boolean>(readValue<boolean>('sidebarCollapsed', false))

  applyTheme(theme.value)

  // React to OS theme changes while on "system".
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system')
  })

  watch(theme, (value) => {
    applyTheme(value)
    writeValue('theme', value)
  })

  watch(sidebarCollapsed, (value) => writeValue('sidebarCollapsed', value))

  function setTheme(value: ThemePreference): void {
    theme.value = value
  }

  function cycleTheme(): void {
    const order: ThemePreference[] = ['light', 'dark', 'system']
    theme.value = order[(order.indexOf(theme.value) + 1) % order.length]
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { theme, sidebarCollapsed, setTheme, cycleTheme, toggleSidebar }
})
