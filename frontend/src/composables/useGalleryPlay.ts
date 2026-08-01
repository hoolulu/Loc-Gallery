import { toggleFavorite } from '@/api'
import { getVideos } from '@/api'
import { usePlayback } from '@/composables/usePlayback'
import { usePlaylistLoader } from '@/composables/usePlaylistLoader'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { Video } from '@/types'

export function useGalleryPlay() {
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const ui = useUiStore()
  const { playVideo } = usePlayback()
  const { bindFromGallery } = usePlaylistLoader()

  async function onPlay(id: string, list?: Video[]) {
    if (player.open) {
      ui.showToast('请先关闭播放器')
      return
    }
    const source = list ?? gallery.videos
    const item = source.find((v) => v.id === id)
    if (!item) return
    bindFromGallery(source)
    player.playlistSort = gallery.sort
    player.playlistRandomSeed = gallery.randomSeed
    await playVideo(item, player.playlist)
  }

  async function onToggleFavorite(id: string) {
    await toggleFavorite(id)
    await gallery.loadVideos()
  }

  async function onRandomPlay() {
    if (player.open) {
      ui.showToast('请先关闭播放器')
      return
    }
    const seed = Date.now()
    gallery.setSort('random')
    gallery.randomSeed = seed
    player.playlistSort = 'random'
    player.playlistRandomSeed = seed
    const params: Record<string, string | number> = {
      sort: 'random',
      seed,
      page: 1,
      page_size: 1,
    }
    if (gallery.category) params.category = gallery.category
    if (gallery.folder) params.folder = gallery.folder
    if (gallery.query) params.q = gallery.query
    if (gallery.formatFilter) params.format = gallery.formatFilter
    if (gallery.viewMode === 'favorites') params.favorites = 'true'
    if (gallery.viewMode === 'history') params.history = 'true'
    if (gallery.viewMode === 'album-detail' && gallery.albumId) params.album_id = gallery.albumId
    const data = await getVideos(params)
    if (!data.items.length) {
      ui.showToast('没有可播放的视频')
      return
    }
    bindFromGallery(gallery.videos)
    await playVideo(data.items[0], player.playlist)
  }

  return { onPlay, onToggleFavorite, onRandomPlay }
}
