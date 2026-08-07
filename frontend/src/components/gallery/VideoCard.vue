<script setup lang="ts">
import { computed } from 'vue'
import { thumbUrl } from '@/api/client'
import { usePathTip } from '@/composables/usePathTip'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import type { Video } from '@/types'
import { formatBadgeLabel } from '@/utils/format'

const props = defineProps<{
  video: Video
  showPlayCount?: boolean
  showProgress?: boolean
}>()

const emit = defineEmits<{
  play: [id: string]
  toggleFavorite: [id: string]
  contextmenu: [event: MouseEvent]
}>()

const ui = useUiStore()
const gallery = useGalleryStore()
const settings = useSettingsStore()
const { scheduleShow, onAnchorLeave, pinned } = usePathTip()
const { startPreview, stopPreview } = useHoverPreview()

const isSelected = computed(() => ui.selectedIds.has(props.video.id))
const albumCount = computed(() => props.video.albumIds?.length || 0)
const albumTitle = computed(() =>
  albumCount.value > 0 ? `已在 ${albumCount.value} 个专辑` : '加入专辑',
)

const progressPct = computed(() => {
  if (!props.video.playDuration || !props.video.playPosition) return 0
  return Math.min(100, (props.video.playPosition / props.video.playDuration) * 100)
})

function formatDuration(sec?: number) {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function thumbPlaceholder() {
  if (props.video.thumbStatus === 'generating') return '生成中…'
  if (props.video.thumbStatus === 'failed') return '生成失败'
  return '无缩略图'
}

function onCardClick() {
  if (ui.manageMode || ui.selectedCount > 0) {
    ui.toggleSelect(props.video.id)
    return
  }
  emit('play', props.video.id)
}

function onCheckChange(e: Event) {
  e.stopPropagation()
  ui.toggleSelect(props.video.id)
}
</script>

<template>
  <article
    class="video-card group relative w-full cursor-pointer self-start overflow-hidden rounded-[var(--lg-radius)] bg-[var(--lg-bg-elevated)] transition"
    :class="{ 'video-card--selected': isSelected }"
    data-testid="video-card"
    @click="onCardClick"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div
      class="thumb-wrap relative aspect-video bg-[var(--lg-thumb-placeholder-bg)]"
      @mouseenter="(e) => {
        scheduleShow(video, e.currentTarget as HTMLElement)
        // 钉住中（浮层保留）不启动新卡片预览；否则正常启动
        if (!pinned) startPreview(video)
      }"
      @mouseleave="(e) => {
        const anchor = e.currentTarget as HTMLElement
        onAnchorLeave(e, anchor)
        // 钉住模式：浮层保留（含预览视频继续播放），由关闭按钮统一停止
        if (settings.settings?.html5_hover_tip_pin === false) stopPreview()
      }"
    >
      <img
        v-if="video.thumbReady"
        :src="thumbUrl(video.id, video.thumbVersion)"
        :alt="video.title"
        class="h-full w-full object-cover"
        loading="lazy"
      />
      <div
        v-else
        class="flex h-full flex-col items-center justify-center text-sm text-[var(--lg-text-muted)]"
        :class="{ 'animate-pulse': video.thumbStatus === 'generating' }"
      >
        {{ thumbPlaceholder() }}
      </div>
      <div
        v-if="showProgress && progressPct > 2"
        class="absolute bottom-0 left-0 right-0 z-[1] h-1 bg-black/40"
      >
        <div class="h-full bg-[var(--lg-accent)]" :style="{ width: `${progressPct}%` }" />
      </div>
      <span v-if="video.formatBadge" class="thumb-overlay thumb-format-badge">
        {{ formatBadgeLabel(video.formatBadge) }}
      </span>
      <span v-if="video.durationSec" class="thumb-overlay thumb-duration">
        {{ formatDuration(video.durationSec) }}
      </span>
      <span
        v-if="showPlayCount && video.playCount"
        class="thumb-overlay thumb-play-count"
      >
        ▶ {{ video.playCount }}
      </span>
      <button
        type="button"
        class="card-album-badge"
        :class="{ on: albumCount > 0 }"
        :title="albumTitle"
        :aria-label="albumTitle"
        @click.stop="ui.openAlbumPicker([video.id])"
      >
        <svg class="card-album-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
          />
        </svg>
      </button>
    </div>

    <button
      type="button"
      class="card-fav"
      :class="{ on: video.favorited }"
      :title="video.favorited ? '取消收藏' : '收藏'"
      :aria-label="video.favorited ? '取消收藏' : '收藏'"
      @click.stop="emit('toggleFavorite', video.id)"
    >
      ♥
    </button>
    <input
      type="checkbox"
      class="card-check"
      :checked="isSelected"
      aria-label="选择"
      @click.stop
      @change="onCheckChange"
    />

    <div class="card-title-wrap px-2 pb-2 pt-1.5">
      <h3 class="card-title line-clamp-2 text-sm leading-snug">{{ video.title }}</h3>
      <p
        v-if="gallery.viewMode === 'history' && video.playedAt"
        class="mt-1 text-xs text-[var(--lg-text-muted)]"
      >
        {{ new Date(video.playedAt * 1000).toLocaleDateString() }}
      </p>
    </div>
  </article>
</template>
