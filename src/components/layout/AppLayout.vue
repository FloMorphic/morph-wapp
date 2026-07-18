<script setup lang="ts">
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <AppSidebar />
      <main class="relative min-w-0 flex-1 overflow-hidden">
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
    </div>
  </div>
</template>
