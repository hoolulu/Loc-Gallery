import { getVideos } from '@/api'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { buildPlaylistParams, type PlaylistContext } from '@/utils/playlist'
import type { SortMode, Video } from '@/types'

export function usePlaylistLoader() {
  const player = usePlayerStore()
  const gallery = useGalleryStore()

  function snapshotContext(): PlaylistContext {
    return {
      category: gallery.category,
      folder: gallery.folder,
      query: gallery.query,
      formatFilter: gallery.formatFilter,
      viewMode: gallery.viewMode,
      albumId: gallery.albumId,
      pageSize: gallery.pageSize,
    }
  }

  function bindFromGallery(videos: Video[]) {
    player.playlistContext = snapshotContext()
    player.playlist = [...videos]
    player.playlistLoadedThrough = gallery.page
    player.playlistTotalPages = gallery.totalPages
    player.playlistCanLoadMore =
      gallery.pageSize !== 0 && gallery.page < gallery.totalPages
  }

  async function bindRandomPlaylist(seed: number): Promise<Video | null> {
    player.playlistContext = snapshotContext()
    player.playlistSort = 'random'
    player.playlistRandomSeed = seed
    const data = await fetchPage(1, 'random', true)
    return data.items[0] ?? null
  }

  function updatePaging(page: number, totalPages: number) {
    player.playlistLoadedThrough = page
    player.playlistTotalPages = totalPages
    player.playlistCanLoadMore =
      player.playlistContext != null &&
      player.playlistContext.pageSize !== 0 &&
      page < totalPages
  }

  function mergeVideos(incoming: Video[]) {
    const seen = new Set(player.playlist.map((v) => v.id))
    const added = incoming.filter((v) => !seen.has(v.id))
    if (added.length) player.playlist = [...player.playlist, ...added]
  }

  async function fetchPage(page: number, sort: SortMode, replace: boolean) {
    const ctx = player.playlistContext ?? snapshotContext()
    const seed = sort === 'random' ? player.playlistRandomSeed : null
    const params = buildPlaylistParams(ctx, page, sort, seed)
    const data = await getVideos(params)
    if (replace) player.playlist = data.items
    else mergeVideos(data.items)
    updatePaging(data.page, data.totalPages)
    return data
  }

  async function loadMore(): Promise<boolean> {
    if (player.playlistLoading || !player.playlistCanLoadMore) return false
    const ctx = player.playlistContext
    if (!ctx || ctx.pageSize === 0) return false
    player.playlistLoading = true
    try {
      const nextPage = player.playlistLoadedThrough + 1
      await fetchPage(nextPage, player.playlistSort, false)
      return true
    } catch {
      return false
    } finally {
      player.playlistLoading = false
    }
  }

  async function reloadForSort(sort: SortMode) {
    player.playlistSort = sort
    if (sort === 'random') player.playlistRandomSeed = Date.now()
    player.playlistLoading = true
    try {
      if (sort === 'page') {
        bindFromGallery(gallery.videos)
        return
      }
      await fetchPage(1, sort, true)
    } finally {
      player.playlistLoading = false
    }
  }

  async function ensureAdjacent(delta: number): Promise<Video | null> {
    const list = player.playlist
    const idx = list.findIndex((v) => v.id === player.playingId)
    if (idx < 0) return null
    let next = list[idx + delta]
    if (!next && delta > 0 && player.playlistCanLoadMore) {
      const loaded = await loadMore()
      if (loaded) {
        const list2 = player.playlist
        next = list2[idx + delta]
      }
    }
    return next ?? null
  }

  function prefetchIfNeeded() {
    if (!player.open || !player.playlistCanLoadMore || player.playlistLoading) return
    const idx = player.playlist.findIndex((v) => v.id === player.playingId)
    if (idx < 0) return
    if (player.playlist.length - idx <= 3) void loadMore()
  }

  return {
    bindFromGallery,
    bindRandomPlaylist,
    loadMore,
    reloadForSort,
    ensureAdjacent,
    prefetchIfNeeded,
  }
}
