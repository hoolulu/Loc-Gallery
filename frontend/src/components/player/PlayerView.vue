<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayback } from '@/composables/usePlayback'
import { usePlaylistLoader } from '@/composables/usePlaylistLoader'
import { usePathTip } from '@/composables/usePathTip'
import { showVideoContextMenu } from '@/composables/useVideoContextActions'
import { usePlayerStore } from '@/stores/player'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import { thumbUrl } from '@/api/client'
import { toggleFavorite } from '@/api'
import { PLAYLIST_SORT_OPTIONS } from '@/constants/sort'
import type { SortMode } from '@/types'

const player = usePlayerStore()
const ui = useUiStore()
const settings = useSettingsStore()
const { playVideo, cancelPlayback, playAdjacent, reloadPlaylist, wheelSeek } = usePlayback()
const { loadMore } = usePlaylistLoader()
const { scheduleShow, onAnchorLeave } = usePathTip()

const playlistOpen = ref(true)
const moviHost = ref<HTMLElement | null>(null)
const playlistScrollRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
const playlistItemRefs = ref<Record<string, HTMLElement>>({})
let observer: IntersectionObserver | null = null

const current = computed(() => player.playingItem)
const playlistSortOptions = PLAYLIST_SORT_OPTIONS

// 宿主 div 就绪后告诉 store，供 startMovi 命令式创建 <movi-player>
watch(moviHost, (el) => {
  player.moviHostEl = el
})

const playlistIndex = computed(() =>
  player.playingId ? player.playlist.findIndex((v) => v.id === player.playingId) : -1,
)
const canGoPrev = computed(() => playlistIndex.value > 0)
const canGoNext = computed(
  () =>
    playlistIndex.value >= 0 &&
    (playlistIndex.value < player.playlist.length - 1 || player.playlistCanLoadMore),
)

const albumCount = computed(() => current.value?.albumIds?.length || 0)
const albumTitle = computed(() =>
  albumCount.value > 0 ? `已在 ${albumCount.value} 个专辑，点击管理` : '加入专辑',
)
const albumLabel = computed(() =>
  albumCount.value > 0 ? `${albumCount.value} 个专辑` : '加入专辑',
)
const playlistToggleLabel = computed(() => (playlistOpen.value ? '收起侧栏' : '播放列表'))
const playlistToggleTitle = computed(() =>
  playlistOpen.value ? '隐藏右侧播放列表' : '显示右侧播放列表',
)

watch([() => player.open, sentinelRef], () => {
  if (player.open) setTimeout(bindPlaylistObserver, 50)
})

function bindPlaylistObserver() {
  observer?.disconnect()
  if (!sentinelRef.value || !playlistScrollRef.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore()
    },
    { root: playlistScrollRef.value, rootMargin: '120px' },
  )
  observer.observe(sentinelRef.value)
}

function scrollPlaylistToActive() {
  const id = player.playingId
  if (!id) return
  void nextTick(() => {
    playlistItemRefs.value[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

watch(
  () => player.playingId,
  () => {
    if (player.open) scrollPlaylistToActive()
  },
)

watch(
  () => player.open,
  (open) => {
    if (open) scrollPlaylistToActive()
  },
)

function setPlaylistItemRef(id: string, el: HTMLElement | null) {
  if (el) playlistItemRefs.value[id] = el
  else delete playlistItemRefs.value[id]
}

function playlistSubline(v: { durationSec?: number; filename?: string }) {
  const dur = formatDuration(v.durationSec)
  if (dur) return `${dur} · ${v.filename || ''}`
  return v.filename || ''
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('pagehide', onPageHide)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pagehide', onPageHide)
  observer?.disconnect()
  player.moviPlayer?.destroy()
  player.moviPlayer = null
  player.moviHostEl = null
})

function onKeydown(e: KeyboardEvent) {
  if (!player.open) return
  const prevKey = settings.settings?.html5_player_prev_key || '.'
  const nextKey = settings.settings?.html5_player_next_key || '/'
  if (e.key === 'Escape') {
    e.preventDefault()
    void cancelPlayback()
  } else if (e.key === prevKey) {
    void playAdjacent(-1)
  } else if (e.key === nextKey) {
    void playAdjacent(1)
  }
}

function onPageHide() {
  const { onPageHide: save } = usePlayback()
  void save()
}

// 画面区滚轮：下滚快进、上滚回退（幅度见设置 html5_wheel_seek_sec）
function onWheel(e: WheelEvent) {
  if (!player.open) return
  e.preventDefault()
  wheelSeek(e.deltaY)
}

async function onPlaylistClick(id: string) {
  const item = player.playlist.find((v) => v.id === id)
  if (item) await playVideo(item, player.playlist)
}

async function onToggleFavorite() {
  if (!current.value) return
  await toggleFavorite(current.value.id)
  current.value.favorited = !current.value.favorited
}

function onAddToAlbum() {
  if (!current.value) return
  ui.openAlbumPicker([current.value.id])
}

async function onPlaylistSortChange(e: Event) {
  await reloadPlaylist((e.target as HTMLSelectElement).value as SortMode)
}
</script>

<template>
  <div
    v-if="player.open"
    data-testid="player-view"
    class="player-view fixed inset-0 z-[100] flex min-h-0 flex-col bg-[var(--lg-bg-player)] text-[var(--lg-text-primary)]"
  >
    <div class="flex min-h-0 flex-1">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="player-stage min-h-0 flex-1" @wheel.prevent="onWheel">
          <!-- <movi-player> web 组件挂载点：自带 canvas 渲染 + 控件 + 字幕 -->
          <div ref="moviHost" class="player-movi-host absolute inset-0"></div>

          <div
            v-if="player.overlayVisible"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[var(--lg-bg-overlay)] px-6 text-center"
          >
            <h3 class="text-lg font-medium">{{ player.overlayTitle }}</h3>
            <p class="mt-2 text-sm text-[var(--lg-text-secondary)]">{{ player.overlayDetail }}</p>
            <div
              v-if="player.overlayIndeterminate"
              class="mt-4 h-1 w-48 overflow-hidden rounded bg-[var(--lg-bg-hover)]"
            >
              <div class="h-full w-1/3 animate-pulse bg-[var(--lg-accent)]" />
            </div>
            <div
              v-else-if="player.overlayProgress != null"
              class="mt-4 h-1 w-48 overflow-hidden rounded bg-[var(--lg-bg-hover)]"
            >
              <div class="h-full bg-[var(--lg-accent)]" :style="{ width: `${player.overlayProgress}%` }" />
            </div>
          </div>

          <p
            v-if="player.statusText"
            class="absolute bottom-4 left-4 z-10 rounded bg-[var(--lg-bg-overlay)] px-2 py-1 text-xs"
          >
            {{ player.statusText }}
          </p>
        </div>

        <header class="player-video-toolbar">
          <div class="player-video-meta min-w-0 flex-1">
            <h2 class="truncate text-sm font-medium">{{ current?.title || current?.filename }}</h2>
            <p class="truncate text-xs text-[var(--lg-text-muted)]">{{ current?.path }}</p>
          </div>
          <div class="player-toolbar-actions">
            <button
              type="button"
              class="player-toolbar-btn"
              :class="{ 'player-toolbar-btn--on': current?.favorited }"
              @click="onToggleFavorite"
            >
              {{ current?.favorited ? '♥ 已收藏' : '♡ 收藏' }}
            </button>
            <button
              type="button"
              class="player-toolbar-btn player-album-btn"
              :class="{ 'player-toolbar-btn--on': albumCount > 0 }"
              :title="albumTitle"
              :aria-label="albumTitle"
              :aria-pressed="albumCount > 0 ? 'true' : 'false'"
              @click="onAddToAlbum"
            >
              📁 {{ albumLabel }}
            </button>
            <button
              type="button"
              class="player-toolbar-btn"
              :class="{ 'player-toolbar-btn--on': playlistOpen }"
              :title="playlistToggleTitle"
              @click="playlistOpen = !playlistOpen"
            >
              {{ playlistToggleLabel }}
            </button>
            <button
              type="button"
              class="player-back-btn"
              title="关闭播放器，返回浏览页 (Esc)"
              @click="cancelPlayback()"
            >
              返回浏览
            </button>
            <button
              type="button"
              class="player-nav-btn"
              :disabled="!canGoPrev"
              title="上一个"
              @click="playAdjacent(-1)"
            >
              上一个
            </button>
            <button
              type="button"
              class="player-nav-btn"
              :disabled="!canGoNext"
              title="下一个"
              @click="playAdjacent(1)"
            >
              下一个
            </button>
          </div>
        </header>
      </div>

      <aside
        v-if="playlistOpen"
        class="flex w-80 shrink-0 flex-col border-l border-[var(--lg-border)] bg-[var(--lg-bg-secondary)]"
      >
        <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-3 py-2">
          <span class="text-sm font-medium">播放列表 ({{ player.playlist.length }})</span>
          <select
            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-1 py-0.5 text-xs"
            :value="player.playlistSort"
            @change="onPlaylistSortChange"
          >
            <option v-for="opt in playlistSortOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div ref="playlistScrollRef" class="player-playlist min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <button
            v-for="v in player.playlist"
            :key="v.id"
            type="button"
            :ref="(el) => setPlaylistItemRef(v.id, el as HTMLElement | null)"
            class="player-pl-item"
            :class="{ active: v.id === player.playingId }"
            :data-id="v.id"
            @click="onPlaylistClick(v.id)"
            @contextmenu.prevent="showVideoContextMenu($event, v.id)"
            @mouseenter="(e) => scheduleShow(v, e.currentTarget as HTMLElement, true)"
            @mouseleave="(e) => onAnchorLeave(e, e.currentTarget as HTMLElement)"
          >
            <div class="player-pl-thumb">
              <img
                v-if="v.thumbReady"
                :src="thumbUrl(v.id, v.thumbVersion)"
                alt=""
                draggable="false"
              />
              <div v-else class="player-pl-thumb-placeholder">暂无缩略图</div>
            </div>
            <div class="player-pl-meta">
              <div class="player-pl-title">{{ v.title }}</div>
              <div class="player-pl-sub">{{ playlistSubline(v) }}</div>
            </div>
          </button>
          <div ref="sentinelRef" class="py-2 text-center text-xs text-[var(--lg-text-muted)]">
            <span v-if="player.playlistLoading">加载中…</span>
            <span v-else-if="player.playlistCanLoadMore">向下滚动加载更多</span>
            <span v-else-if="player.playlist.length">已加载全部</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
