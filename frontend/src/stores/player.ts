import { defineStore } from 'pinia'
import { ref } from 'vue'
import type Hls from 'hls.js'
import type { SortMode, Video } from '@/types'
import type { PlaylistContext } from '@/utils/playlist'

export const usePlayerStore = defineStore('player', () => {
  const open = ref(false)
  const playingId = ref<string | null>(null)
  const playingItem = ref<Video | null>(null)
  const playSession = ref(0)
  const playlist = ref<Video[]>([])
  const playlistSort = ref<SortMode>('page')
  const playlistRandomSeed = ref<number | null>(null)
  const hlsInstance = ref<Hls | null>(null)
  const activeSliceVideoId = ref<string | null>(null)
  const overlayVisible = ref(false)
  const overlayTitle = ref('')
  const overlayDetail = ref('')
  const overlayProgress = ref<number | null>(null)
  const overlayIndeterminate = ref(false)
  const statusText = ref('')
  const videoEl = ref<HTMLVideoElement | null>(null)
  const playlistContext = ref<PlaylistContext | null>(null)
  const playlistLoadedThrough = ref(0)
  const playlistTotalPages = ref(0)
  const playlistCanLoadMore = ref(false)
  const playlistLoading = ref(false)
  const lastPlayedItem = ref<Video | null>(null)

  function resetPlaylistMeta() {
    playlistContext.value = null
    playlistLoadedThrough.value = 0
    playlistTotalPages.value = 0
    playlistCanLoadMore.value = false
    playlistLoading.value = false
  }

  function bumpSession() {
    playSession.value += 1
    return playSession.value
  }

  function isStale(session: number) {
    return session !== playSession.value
  }

  function showOverlay(title: string, detail = '', opts: { progress?: number | null; indeterminate?: boolean } = {}) {
    overlayVisible.value = true
    overlayTitle.value = title
    overlayDetail.value = detail
    overlayProgress.value = opts.progress ?? null
    overlayIndeterminate.value = !!opts.indeterminate
  }

  function hideOverlay() {
    overlayVisible.value = false
    overlayTitle.value = ''
    overlayDetail.value = ''
    overlayProgress.value = null
    overlayIndeterminate.value = false
  }

  function openPlayer(item: Video, list: Video[] = []) {
    open.value = true
    playingId.value = item.id
    playingItem.value = item
    lastPlayedItem.value = item
    if (list.length) playlist.value = list
    else if (!playlist.value.find((v) => v.id === item.id)) {
      playlist.value = [item]
    }
  }

  function closePlayer() {
    if (playingItem.value) lastPlayedItem.value = playingItem.value
    open.value = false
    playingId.value = null
    playingItem.value = null
    hideOverlay()
    statusText.value = ''
  }

  return {
    open,
    playingId,
    playingItem,
    playSession,
    playlist,
    playlistSort,
    playlistRandomSeed,
    hlsInstance,
    activeSliceVideoId,
    overlayVisible,
    overlayTitle,
    overlayDetail,
    overlayProgress,
    overlayIndeterminate,
    statusText,
    videoEl,
    playlistContext,
    playlistLoadedThrough,
    playlistTotalPages,
    playlistCanLoadMore,
    playlistLoading,
    lastPlayedItem,
    resetPlaylistMeta,
    bumpSession,
    isStale,
    showOverlay,
    hideOverlay,
    openPlayer,
    closePlayer,
  }
})
