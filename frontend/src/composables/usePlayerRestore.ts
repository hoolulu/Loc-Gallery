import { getVideo } from '@/api'
import { usePlayback } from '@/composables/usePlayback'
import { usePlaylistLoader } from '@/composables/usePlaylistLoader'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'

let restoredPlayId: string | null = null

export function resetPlayerRestore() {
  restoredPlayId = null
}

export function usePlayerRestore() {
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const { playVideo } = usePlayback()
  const { bindFromGallery } = usePlaylistLoader()

  async function tryRestore(videoId: string) {
    if (!videoId || player.open) return
    if (restoredPlayId === videoId) return
    restoredPlayId = videoId

    try {
      const video = await getVideo(videoId)
      if (gallery.videos.length) {
        bindFromGallery(gallery.videos)
      } else {
        bindFromGallery([video])
      }
      if (!player.playlist.some((v) => v.id === videoId)) {
        player.playlist = [video, ...player.playlist.filter((v) => v.id !== videoId)]
      }
      player.playlistSort = gallery.sort
      player.playlistRandomSeed = gallery.randomSeed
      await playVideo(video, player.playlist)
    } catch {
      restoredPlayId = null
    }
  }

  return { tryRestore }
}
