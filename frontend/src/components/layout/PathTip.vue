<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { thumbUrl } from '@/api/client'
import { useSettingsStore } from '@/stores/settings'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { formatDuration, formatSize, formatBadgeLabel } from '@/utils/format'

const settings = useSettingsStore()
const { visible, item, tipLeft, tipTop, measuring, pinned, afterLayout, closeTip } = usePathTip()
const { placeholderLoading, stopPreviewNow } = useHoverPreview()
const tipRef = ref<HTMLElement | null>(null)

// 悬浮预览启用：预览区渲染「加载占位」而非缩略图，视频就绪后在其上淡入播放
const hoverPreviewEnabled = computed(
  () => settings.settings?.html5_hover_preview !== false,
)

function onCloseTip() {
  stopPreviewNow()
  closeTip()
}

// 钉住模式：点击浮层外部任意位置等同关闭（与关闭按钮行为一致）
function onDocClick(e: MouseEvent) {
  if (!pinned) return
  const target = e.target as Node | null
  if (tipRef.value && target && tipRef.value.contains(target)) return
  onCloseTip()
}

watch(pinned, (v) => {
  if (v) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onUnmounted(() => document.removeEventListener('click', onDocClick))

function getPathDir(path: string, filename: string) {
  if (!path) return ''
  if (filename && path.endsWith(filename)) {
    return path.slice(0, path.length - filename.length).replace(/[\\/]+$/, '')
  }
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return idx >= 0 ? path.slice(0, idx) : ''
}

function shortenMiddle(str: string, maxLen: number) {
  if (!str || str.length <= maxLen) return str || ''
  const edge = Math.max(6, Math.floor((maxLen - 1) / 2))
  return `${str.slice(0, edge)}…${str.slice(-edge)}`
}

function formatTs(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  if (d.getFullYear() === now.getFullYear()) return `${m}-${day} ${hh}:${mm}`
  return `${y}-${m}-${day} ${hh}:${mm}`
}

const dirSegments = computed(() => {
  const v = item.value
  if (!v) return []
  const dir = getPathDir(v.path, v.filename)
  const parts = dir.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 5) return parts
  return ['…', ...parts.slice(-(5 - 1))]
})

const techChips = computed(() => {
  const v = item.value
  if (!v) return []
  const chips: string[] = []
  const dur = formatDuration(v.durationSec)
  if (dur) chips.push(`时长 ${dur}`)
  if (v.formatBadge) chips.push(formatBadgeLabel(v.formatBadge))
  if (v.size) chips.push(formatSize(v.size))
  if (v.mtime) chips.push(`修改于 ${formatTs(v.mtime)}`)
  return chips
})

const userChips = computed(() => {
  const v = item.value
  if (!v) return []
  const chips: string[] = []
  if (v.favorited && v.favoritedAt) chips.push(`收藏于 ${formatTs(v.favoritedAt)}`)
  else if (v.favorited) chips.push('已收藏')
  if (v.playedAt) {
    const n = v.playCount || 1
    chips.push(`最近播放 ${formatTs(v.playedAt)} · 累计 ${n} 次`)
  }
  return chips
})

function onImgLoad() {
  void nextTick(() => afterLayout(tipRef.value))
}

watch(visible, (v) => {
  if (v) void nextTick(() => afterLayout(tipRef.value))
})
</script>

<template>
  <div
    v-if="visible && item"
    ref="tipRef"
    class="path-tip"
    :class="{ 'path-tip--measuring': measuring }"
    role="tooltip"
    :style="{ left: `${tipLeft}px`, top: `${tipTop}px` }"
    :title="item.path"
  >
    <button
      v-if="pinned"
      class="path-tip-close"
      title="关闭预览"
      @click="onCloseTip"
    >
      ✕
    </button>
    <div class="path-tip-preview">
      <!-- 悬浮预览启用：深色加载占位（16:9 固定），视频就绪后由 useHoverPreview 在其上淡入 -->
      <div
        v-if="hoverPreviewEnabled"
        class="path-tip-preview--placeholder"
        :class="{ 'path-tip-preview--placeholder-idle': !placeholderLoading }"
      >
        <span v-if="placeholderLoading" class="hover-preview-spinner" />
      </div>
      <!-- 悬浮预览关闭：回到缩略图展示 -->
      <template v-else>
        <img
          v-if="item.thumbReady || item.thumbVersion"
          :src="thumbUrl(item.id, item.thumbVersion)"
          alt=""
          decoding="async"
          @load="onImgLoad"
        />
        <div v-else class="path-tip-preview--empty">暂无缩略图</div>
      </template>
      <span v-if="item.formatBadge" class="thumb-format-badge">{{ formatBadgeLabel(item.formatBadge) }}</span>
      <span v-if="item.durationSec" class="thumb-duration">{{ formatDuration(item.durationSec) }}</span>
    </div>
    <div class="path-tip-body">
      <div v-if="dirSegments.length" class="path-tip-dir">
        <template v-for="(seg, i) in dirSegments" :key="i">
          <span v-if="i > 0">\</span>
          <span>{{ seg }}</span>
        </template>
      </div>
      <div v-if="item.filename" class="path-tip-file" :title="item.filename">
        {{ shortenMiddle(item.filename, 40) }}
      </div>
      <div v-if="techChips.length" class="path-tip-meta">
        <span v-for="chip in techChips" :key="chip" class="path-tip-chip">{{ chip }}</span>
      </div>
      <div v-if="userChips.length" class="path-tip-meta">
        <span v-for="chip in userChips" :key="chip" class="path-tip-chip">{{ chip }}</span>
      </div>
    </div>
  </div>
</template>
