<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 26 })
</script>

<template>
  <!-- FloMorphic mark: three morphing nodes flowing into one. -->
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="fm-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--accent)" />
        <stop offset="1" stop-color="var(--accent-hover)" />
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="url(#fm-grad)" stroke-width="1.6" opacity="0.4" />
    <circle cx="9" cy="10" r="3" fill="url(#fm-grad)" />
    <circle cx="9" cy="22" r="3" fill="url(#fm-grad)" opacity="0.55" />
    <circle cx="23" cy="16" r="3.4" fill="url(#fm-grad)" />
    <path d="M12 10.5C16 12 18 14 20 15.5M12 21.5C16 20 18 18 20 16.5" stroke="url(#fm-grad)" stroke-width="1.8" stroke-linecap="round" />
  </svg>
</template>
