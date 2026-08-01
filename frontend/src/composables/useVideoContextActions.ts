import { onMounted, onUnmounted } from 'vue'
import { openFolder, renameVideo, deleteVideos } from '@/api/files'
import { regenerateThumbSmart } from '@/composables/useThumbRegenerate'
import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { usePlayback } from '@/composables/usePlayback'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import type { ContextMenuItem } from '@/stores/ui'

export function videoContextMenuItems(): ContextMenuItem[] {
  return [
    { label: '重命名', action: 'rename' },
    { label: '移动到分类', action: 'move' },
    { label: '播放', action: 'play' },
    { label: '收藏/取消收藏', action: 'favorite' },
    { label: '加入专辑', action: 'add-album' },
    { label: '打开所在文件夹', action: 'open-folder' },
    { label: '换缩略图', action: 'regen-thumb' },
    { label: '删除', action: 'delete', danger: true },
  ]
}

export function showVideoContextMenu(e: MouseEvent, videoId: string) {
  const ui = useUiStore()
  ui.showContextMenu(e, videoContextMenuItems(), { targetId: videoId, targetType: 'video' })
}

export function setupVideoContextActions() {
  const gallery = useGalleryStore()
  const player = usePlayerStore()
  const ui = useUiStore()
  const { onPlay, onToggleFavorite } = useGalleryPlay()
  const { playVideo } = usePlayback()

  async function onContextAction(ev: Event) {
    const detail = (ev as CustomEvent).detail as {
      action: string
      targetId?: string
      targetType?: string
    }
    if (detail.targetType !== 'video') return
    const id = detail.targetId
    if (!id) return

    if (detail.action === 'play') {
      if (player.open) {
        const item = player.playlist.find((v) => v.id === id) ?? gallery.videos.find((v) => v.id === id)
        if (item) await playVideo(item, player.playlist)
      } else {
        await onPlay(id)
      }
    } else if (detail.action === 'favorite') {
      await onToggleFavorite(id)
      const plItem = player.playlist.find((v) => v.id === id)
      if (plItem) plItem.favorited = !plItem.favorited
    } else if (detail.action === 'add-album') {
      ui.openAlbumPicker([id])
    } else if (detail.action === 'open-folder') {
      await openFolder(id)
    } else if (detail.action === 'regen-thumb') {
      await regenerateThumbSmart(id)
      await gallery.loadVideos()
    } else if (detail.action === 'rename') {
      const item = gallery.videos.find((v) => v.id === id) ?? player.playlist.find((v) => v.id === id)
      const name = prompt('新文件名', item?.filename || item?.title || '')
      if (name) {
        await renameVideo(id, name)
        await gallery.loadVideos()
        ui.showToast('已重命名')
      }
    } else if (detail.action === 'move') {
      ui.openFolderMove({ mode: 'videos', videoIds: [id], category: gallery.category || undefined })
    } else if (detail.action === 'delete') {
      if (!confirm('确定删除此视频？')) return
      await deleteVideos([id])
      await gallery.loadVideos()
      ui.showToast('已删除')
    }
  }

  onMounted(() => document.addEventListener('lg-context-action', onContextAction))
  onUnmounted(() => document.removeEventListener('lg-context-action', onContextAction))
}
