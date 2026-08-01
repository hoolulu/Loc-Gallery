import { toggleFavorite } from '@/api'
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
  const { bindFromGallery, bindRandomPlaylist } = usePlaylistLoader()

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
    try {
      const item = await bindRandomPlaylist(seed)
      if (!item) {
        ui.showToast('没有可播放的视频')
        return
      }
      await playVideo(item, player.playlist)
    } catch (err) {
      ui.showToast(`随机播放失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { onPlay, onToggleFavorite, onRandomPlay }
}
