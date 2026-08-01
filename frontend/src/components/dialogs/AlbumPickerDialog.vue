<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { addVideosToAlbum, removeVideosFromAlbum } from '@/api/albums'
import { useAlbumStore } from '@/stores/album'
import { useGalleryStore } from '@/stores/gallery'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const album = useAlbumStore()
const gallery = useGalleryStore()
const player = usePlayerStore()

const loading = ref(false)
const checked = reactive<Record<string, boolean>>({})
const initialChecked = reactive<Record<string, boolean>>({})

const hint = computed(() => {
  const n = ui.albumPickerIds.length
  return n === 1
    ? '勾选要加入的专辑，取消勾选将从专辑移除。'
    : `为 ${n} 个视频选择专辑归属。`
})

function videoById(id: string) {
  return (
    gallery.videos.find((v) => v.id === id) ??
    player.playlist.find((v) => v.id === id) ??
    (player.playingId === id ? player.playingItem : undefined)
  )
}

function membership(albumId: string) {
  const ids = ui.albumPickerIds
  const hits = ids.filter((id) => (videoById(id)?.albumIds || []).includes(albumId))
  return {
    all: hits.length === ids.length,
    some: hits.length > 0 && hits.length < ids.length,
  }
}

function resetState() {
  for (const key of Object.keys(checked)) delete checked[key]
  for (const key of Object.keys(initialChecked)) delete initialChecked[key]
}

function initCheckboxes() {
  resetState()
  for (const a of album.albums) {
    const m = membership(a.id)
    checked[a.id] = m.all
    initialChecked[a.id] = m.all
  }
}

function patchVideoAlbumIds(videoId: string, albumId: string, add: boolean) {
  const apply = (video: { albumIds?: string[] } | null | undefined) => {
    if (!video) return
    const ids = new Set(video.albumIds || [])
    if (add) ids.add(albumId)
    else ids.delete(albumId)
    video.albumIds = [...ids]
  }
  apply(gallery.videos.find((v) => v.id === videoId))
  apply(player.playlist.find((v) => v.id === videoId))
  if (player.playingId === videoId) apply(player.playingItem)
}

watch(
  () => ui.albumPickerOpen,
  async (open) => {
    if (!open) {
      resetState()
      return
    }
    loading.value = true
    try {
      await album.loadAlbums()
      initCheckboxes()
    } catch (err) {
      ui.showToast(`加载专辑列表失败: ${err instanceof Error ? err.message : String(err)}`)
      ui.closeAlbumPicker()
    } finally {
      loading.value = false
    }
  },
)

async function confirm() {
  const ids = ui.albumPickerIds
  if (!ids.length) return

  const ops: { albumId: string; add?: string[]; remove?: string[] }[] = []
  for (const a of album.albums) {
    const want = !!checked[a.id]
    const had = !!initialChecked[a.id]
    if (want && !had) {
      const missing = ids.filter((id) => !(videoById(id)?.albumIds || []).includes(a.id))
      if (missing.length) ops.push({ albumId: a.id, add: missing })
    } else if (!want && had) {
      const present = ids.filter((id) => (videoById(id)?.albumIds || []).includes(a.id))
      if (present.length) ops.push({ albumId: a.id, remove: present })
    }
  }

  if (!ops.length) {
    ui.showToast('专辑归属未变更')
    ui.closeAlbumPicker()
    return
  }

  try {
    for (const op of ops) {
      if (op.add?.length) {
        await addVideosToAlbum(op.albumId, op.add)
        op.add.forEach((id) => patchVideoAlbumIds(id, op.albumId, true))
      }
      if (op.remove?.length) {
        await removeVideosFromAlbum(op.albumId, op.remove)
        op.remove.forEach((id) => patchVideoAlbumIds(id, op.albumId, false))
      }
    }
    ui.showToast('专辑归属已更新')
    ui.closeAlbumPicker()
  } catch (err) {
    ui.showToast(`更新专辑归属失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function close() {
  ui.closeAlbumPicker()
}
</script>

<template>
  <dialog
    v-if="ui.albumPickerOpen"
    open
    class="album-picker-dialog fixed inset-0 z-[250] m-auto w-full max-w-md rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] p-0 text-[var(--lg-text-primary)] shadow-2xl backdrop:bg-black/60"
  >
    <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-4 py-3">
      <h2 class="text-lg font-medium">加入专辑</h2>
      <button type="button" class="rounded px-2 py-1 lg-hover" @click="close">✕</button>
    </div>
    <p class="px-4 pt-3 text-sm text-[var(--lg-text-muted)]">{{ hint }}</p>
    <div class="max-h-64 overflow-y-auto p-3">
      <div v-if="loading" class="py-8 text-center text-sm text-[var(--lg-text-muted)]">加载中…</div>
      <p v-else-if="!album.albums.length" class="py-6 text-center text-sm text-[var(--lg-text-muted)]">
        还没有专辑，可先在「我的专辑」中新建。
      </p>
      <label
        v-for="a in album.albums"
        v-else
        :key="a.id"
        class="album-picker-item"
      >
        <input v-model="checked[a.id]" type="checkbox" :value="a.id" />
        <span class="album-picker-name">{{ a.name }}</span>
        <span class="album-picker-count">{{ a.video_count || 0 }} 个视频</span>
      </label>
    </div>
    <div class="flex justify-end gap-2 border-t border-[var(--lg-border)] px-4 py-3">
      <button type="button" class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm" @click="close">
        取消
      </button>
      <button
        type="button"
        class="rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)] disabled:opacity-40"
        :disabled="loading"
        @click="confirm"
      >
        确定
      </button>
    </div>
  </dialog>
</template>
