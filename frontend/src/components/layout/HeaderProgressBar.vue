<script setup lang="ts">
import { useThumbProgress } from '@/composables/useThumbProgress'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const {
  thumbProgress,
  durationStatus,
  showBar,
  progressText,
  durationHint,
  durationBusy,
  formatDurationProgressText,
  togglePause,
} = useThumbProgress()
</script>

<template>
  <div
    class="progress-bar-wrap"
    :class="{ 'progress-bar-collapsed': !showBar }"
  >
    <div class="progress-info">
      <div class="progress-info-left">
        <span class="progress-text">{{ progressText }}</span>
        <span
          v-if="thumbProgress?.idle_scan"
          class="idle-scan-badge"
          title="正在后台补全全库缩略图"
        >
          后台补全
        </span>
      </div>
      <div class="progress-actions">
        <button
          v-if="!thumbProgress?.paused"
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          暂停
        </button>
        <button
          v-else
          type="button"
          class="progress-btn"
          @click="togglePause"
        >
          继续
        </button>
        <button
          v-if="((thumbProgress?.failed as number) ?? 0) > 0"
          type="button"
          class="progress-btn"
          @click="ui.thumbFailedOpen = true"
        >
          失败 {{ thumbProgress?.failed }}
        </button>
      </div>
    </div>
    <div class="progress-track">
      <div
        class="progress-fill"
        :style="{ width: `${Math.max(0, Math.min(100, (thumbProgress?.percent as number) ?? 0))}%` }"
      />
    </div>

    <div v-if="durationBusy" class="duration-progress-wrap">
      <div class="progress-info">
        <div class="progress-info-left">
          <span class="progress-text">{{ formatDurationProgressText(durationStatus) }}</span>
        </div>
      </div>
      <div class="progress-track">
        <div
          class="progress-fill duration-progress-fill"
          :style="{ width: `${Math.max(0, Math.min(100, (durationStatus?.percent as number) ?? 0))}%` }"
        />
      </div>
      <p class="duration-progress-hint">{{ durationHint }}</p>
    </div>
  </div>
</template>
