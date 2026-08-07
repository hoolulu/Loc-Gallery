<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { thumbUrl } from '@/api/client'
import { useSettingsStore } from '@/stores/settings'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { formatDuration, formatSize, formatBadgeLabel } from '@/utils/format'

const settings = useSettingsStore()
const { visible, item, tipLeft, tipTop, measuring, pinned, afterLayout, closeTip } = usePathTip()
const { placeholderLoading, stopPreviewNow, previewRatio, previewFailed } = useHoverPreview()
const tipRef = ref<HTMLElement | null>(null)

// 悬浮预览启用：预览区渲染「加载占位」而非缩略图，视频就绪后在其上淡入播放
const hoverPreviewEnabled = computed(
  () => settings.settings?.html5_hover_preview !== false,
)

// 浮层显示条件：浮层始终在 visible 后渲染（v-if），但位置挂起在 -9999；
// 「就绪」才定位：预览开启时等比例就绪（一次定位不跳动），预览关闭时立即定位
const tipReady = computed(
  () =>
    !!item.value &&
    (!hoverPreviewEnabled.value || !!previewRatio.value || !!previewFailed.value),
)

// 预览区渲染条件：预览开启且比例就绪（有真实尺寸才渲染，避免空容器挂 video 黑屏）
const previewAreaVisible = computed(
  () => hoverPreviewEnabled.value && !!previewRatio.value,
)

// 占位尺寸按原视频宽高比自适应：约束最大宽/高，竖屏（比例<1）宽度随高度反推
const PREVIEW_MAX_W = () => Math.min(window.innerWidth * 0.88, 1104)
const PREVIEW_MAX_H = () => Math.min(window.innerHeight * 0.7, 864)
const placeholderStyle = computed(() => {
  const ratio = previewRatio.value
  const maxW = PREVIEW_MAX_W()
  const maxH = PREVIEW_MAX_H()
  if (!ratio || ratio <= 0) {
    // 未知比例：默认 16:9 占位
    return { width: `${maxW}px`, aspectRatio: '16 / 9', maxWidth: `${maxW}px`, maxHeight: `${maxH}px` }
  }
  // 以宽度优先：w = maxW，h = w / ratio；若 h 超 maxH 则 h = maxH，w = h * ratio
  let w = maxW
  let h = maxW / ratio
  if (h > maxH) {
    h = maxH
    w = maxH * ratio
  }
  return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` }
})

// 视频比例变化（竖屏/横屏）后重新测量浮层尺寸并定位
// 等占位尺寸过渡（0.18s）完成后再测，避免取到过渡中间值
watch(previewRatio, () => {
  window.setTimeout(() => void nextTick(() => afterLayout(tipRef.value)), 200)
})

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

// 浮层就绪（visible 且比例就绪/失败）后执行定位测量
watch(tipReady, (v) => {
  if (v && visible.value) void nextTick(() => afterLayout(tipRef.value))
})
// 预览开启时 visible 可能先于比例就绪，tipReady 变化已覆盖；此处兼容直接 visible 场景
watch(visible, (v) => {
  if (v && tipReady.value) void nextTick(() => afterLayout(tipRef.value))
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
      <!-- 悬浮预览启用：预览区仅在视频比例就绪后渲染（直接以正确比例出现，
           不经过 16:9 占位 → 真实比例的横→竖变化，也不在加载中显示缩略图）；
           比例未就绪时预览区留空（浮层仅显示文字），就绪后 spinner → 视频淡入 -->
      <div
        v-if="previewAreaVisible"
        class="path-tip-preview--placeholder"
        :class="{ 'path-tip-preview--placeholder-idle': !placeholderLoading }"
        :style="placeholderStyle"
      >
        <span v-if="placeholderLoading" class="hover-preview-spinner" />
      </div>
      <!-- 悬浮预览关闭：回到缩略图展示（仅在设置关闭预览时） -->
      <template v-else-if="!hoverPreviewEnabled">
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
