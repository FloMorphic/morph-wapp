<script setup lang="ts">
import markUrl from '@/assets/brand/flomorphic-mark.png'

withDefaults(defineProps<{ size?: number }>(), { size: 26 })
</script>

<template>
  <span class="fm-logo" :style="{ '--fm-logo-size': `${size}px` }" role="img" aria-label="FloMorphic">
    <img class="fm-logo__mark" :src="markUrl" alt="" aria-hidden="true" />
  </span>
</template>

<style scoped>
/*
  The FloMorphic mark is full-colour artwork whose gradient fades to *opaque
  white*, not to transparency — it was drawn for the dark inflowenger.com
  surface, where that pale end is what gives the swirl its ring. Dropped on a
  light background the ring dissolves and the mark all but vanishes at header
  size, so light theme seats it on a dark chip and dark theme leaves the chip
  transparent (see --logo-chip in style.css).
*/
.fm-logo {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--fm-logo-size);
  height: var(--fm-logo-size);
  border-radius: 28%;
  background: var(--logo-chip);
}

.fm-logo__mark {
  display: block;
  width: 80%;
  height: 80%;
}
</style>
