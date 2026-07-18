<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import Logo from '@/components/ui/Logo.vue'

const router = useRouter()
</script>

<template>
  <div class="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-bg text-center">
    <Logo :size="44" />
    <h1 class="text-3xl font-bold text-fg">404</h1>
    <p class="max-w-sm text-sm text-fg-muted">This page morphed into something that doesn’t exist.</p>
    <Button variant="primary" icon="arrow-left" @click="router.push('/workflows')">Back to workflows</Button>
  </div>
</template>
