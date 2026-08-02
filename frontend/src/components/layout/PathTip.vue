<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { thumbUrl } from '@/api/client'
import { usePathTip } from '@/composables/usePathTip'
import { formatDuration, formatSize, formatBadgeLabel } from '@/utils/format'

const { visible, item, tipLeft, tipTop, measuring, afterLayout } = usePathTip()
const tipRef = ref<HTMLElement | null>(null)

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
    <div v-if="item.thumbReady || item.thumbVersion" class="path-tip-preview">
      <img
        :src="thumbUrl(item.id, item.thumbVersion)"
        alt=""
        decoding="async"
        @load="onImgLoad"
      />
      <span v-if="item.formatBadge" class="thumb-format-badge">{{ formatBadgeLabel(item.formatBadge) }}</span>
      <span v-if="item.durationSec" class="thumb-duration">{{ formatDuration(item.durationSec) }}</span>
    </div>
    <div v-else class="path-tip-preview path-tip-preview--empty">暂无缩略图</div>
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
