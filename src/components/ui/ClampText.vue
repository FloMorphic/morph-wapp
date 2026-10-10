<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Collapses long body text to a fixed number of lines with a "Show more" /
 * "Show less" toggle, shown only when the content actually overflows.
 *
 * Length is judged by rendered lines, not a word count: the text wraps
 * differently at every drawer width, so a word threshold would clamp a short
 * line-wrapped block and miss a long one-line-per-sentence block. The toggle
 * appears only when the laid-out text exceeds `lines`, re-checked whenever the
 * box reflows (the settings drawer is resizable).
 *
 * The slot is inline content — pass the styled text element's classes via
 * `contentClass` so the clamp and the measurement run on the element that
 * carries the real font-size and line-height.
 */
const props = withDefaults(defineProps<{ lines?: number; contentClass?: string }>(), {
  lines: 5,
  contentClass: '',
})

const bodyRef = ref<HTMLElement | null>(null)
const expanded = ref(false)
const overflowing = ref(false)
let ro: ResizeObserver | null = null

function measure() {
  const el = bodyRef.value
  if (!el) {
    overflowing.value = false
    return
  }
  const cs = getComputedStyle(el)
  let lineHeight = parseFloat(cs.lineHeight)
  if (!Number.isFinite(lineHeight)) {
    // `line-height: normal` resolves to no px value — approximate from the font.
    lineHeight = (parseFloat(cs.fontSize) || 16) * 1.5
  }
  // `scrollHeight` is the full content height in both states — the clamp hides
  // the overflow but does not shrink the content — so one comparison against
  // the collapsed line budget decides the toggle regardless of expand state.
  overflowing.value = el.scrollHeight > lineHeight * props.lines + 1
}

onMounted(() => {
  measure()
  // Fonts or a late reflow can change the metrics after the first paint.
  requestAnimationFrame(measure)
  ro = new ResizeObserver(measure)
  if (bodyRef.value) ro.observe(bodyRef.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div>
    <div
      ref="bodyRef"
      :class="[contentClass, { clamp: !expanded }]"
      :style="{ '--clamp-lines': lines }"
    >
      <slot />
    </div>
    <button
      v-if="overflowing"
      class="mt-1 text-[11px] font-medium text-accent hover:underline"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show less' : 'Show more' }}
    </button>
  </div>
</template>

<style scoped>
.clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--clamp-lines, 5);
  line-clamp: var(--clamp-lines, 5);
  overflow: hidden;
}
</style>
