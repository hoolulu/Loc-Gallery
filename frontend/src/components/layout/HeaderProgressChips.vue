<script setup lang="ts">
import { useThumbProgress } from '@/composables/useThumbProgress'

const {
  showThumbChip,
  thumbDotClass,
  thumbChipTitle,
  showBar,
  durationBusy,
  toggleBar,
} = useThumbProgress()
</script>

<template>
  <button
    v-if="durationBusy"
    type="button"
    class="thumb-status-chip"
    :class="{ 'thumb-status-chip--expanded': showBar }"
    title="视频时长后台探测中，点击展开详情"
    aria-label="视频时长探测"
    @click="toggleBar"
  >
    <span class="thumb-status-dot thumb-status-dot--busy" aria-hidden="true" />
    <span class="thumb-status-label">时长</span>
  </button>

  <button
    v-if="showThumbChip"
    type="button"
    class="thumb-status-chip"
    :class="{ 'thumb-status-chip--expanded': showBar }"
    :title="thumbChipTitle"
    :aria-expanded="showBar ? 'true' : 'false'"
    aria-label="缩略图，点击查看详情"
    @click="toggleBar"
  >
    <span class="thumb-status-dot" :class="thumbDotClass" aria-hidden="true" />
    <span class="thumb-status-label">缩略图</span>
  </button>
</template>
