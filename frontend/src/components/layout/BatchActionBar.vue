<script setup lang="ts">

import { computed } from 'vue'

import { batchFavorites, beginBatchRemux, deleteVideos, endBatchRemux } from '@/api/files'

import { getPlayInfo, startRemux, getRemuxStatus } from '@/api/play'

import { batchRegenerateThumb } from '@/api/thumbs'
import { openThumbPicker } from '@/composables/useThumbPicker'
import { useSettingsStore } from '@/stores/settings'

import { useGalleryStore } from '@/stores/gallery'

import { useUiStore } from '@/stores/ui'



const ui = useUiStore()

const gallery = useGalleryStore()
const settingsStore = useSettingsStore()



const visible = computed(() => ui.selectedCount > 0)

const ids = computed(() => [...ui.selectedIds])



async function onSelectAll() {

  ui.selectAll(gallery.videos.map((v) => v.id))

}



async function onDelete() {

  if (!confirm(`确定删除 ${ids.value.length} 个视频？`)) return

  await deleteVideos(ids.value)

  ui.clearSelection(true)

  await gallery.loadVideos()

  ui.showToast('已删除')

}



async function onFavorite(add: boolean) {

  await batchFavorites(ids.value, add ? 'add' : 'remove')

  ui.clearSelection(true)

  await gallery.loadVideos()

}



function onAddToAlbum() {

  ui.openAlbumPicker(ids.value)

  ui.clearSelection(true)

}



function onBatchMove() {
  ui.openFolderMove({ mode: 'videos', videoIds: ids.value, category: gallery.category || undefined })
  ui.clearSelection(true)
}

async function onBatchRegenThumb() {
  await settingsStore.loadSettings()
  const batchAuto = settingsStore.settings?.thumb_batch_auto_select !== false
  const videoIds = ids.value

  if (!batchAuto) {
    ui.clearSelection(true)
    for (let i = 0; i < videoIds.length; i++) {
      const id = videoIds[i]
      const item = gallery.videos.find((v) => v.id === id)
      const title = item?.title || item?.filename || id
      await openThumbPicker(id, `${i + 1}/${videoIds.length} · ${title}`)
    }
    await gallery.loadVideos()
    ui.showToast('批量换图完成')
    return
  }

  await batchRegenerateThumb(videoIds, true)
  ui.clearSelection(true)
  await gallery.loadVideos()
  ui.showToast('已加入换图队列')
}



async function onBatchRemux() {

  const remuxable: { id: string; title: string }[] = []

  for (const id of ids.value) {

    try {

      const info = await getPlayInfo(id)

      if (info.remuxable) {

        const item = gallery.videos.find((v) => v.id === id)

        remuxable.push({ id, title: item?.title || id })

      }

    } catch {

      /* skip */

    }

  }

  if (!remuxable.length) {

    ui.showToast('没有可修复的视频')

    return

  }

  if (!confirm(`将修复 ${remuxable.length} 个视频，继续？`)) return

  await beginBatchRemux()

  try {

    for (const { id, title } of remuxable) {

      ui.showToast(`正在修复: ${title}`)

      await startRemux(id)

      const start = Date.now()

      while (Date.now() - start < 600000) {

        const st = await getRemuxStatus(id)

        if (st.state === 'done') break

        if (st.state === 'error') break

        await new Promise((r) => setTimeout(r, 800))

      }

    }

    ui.showToast('批量修复完成')

  } finally {

    await endBatchRemux().catch(() => {})

  }

  ui.clearSelection(true)

  await gallery.loadVideos()

}

</script>



<template>

  <div

    v-if="visible"

    class="batch-action-bar shrink-0 flex flex-wrap items-center justify-center gap-2 border-t border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] px-4 py-3 shadow-lg"

  >

    <span class="text-sm">已选 {{ ui.selectedCount }} 项</span>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onSelectAll">全选</button>
    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="ui.clearSelection()">取消全选</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onFavorite(true)">收藏</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onFavorite(false)">取消收藏</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onAddToAlbum">加入专辑</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onBatchMove">移动</button>
    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onBatchRemux">批量修复</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="onBatchRegenThumb">换缩略图</button>

    <button class="rounded border border-red-500/50 px-3 py-1 text-sm text-red-400" @click="onDelete">删除</button>

    <button class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm" @click="ui.clearSelection(true)">取消</button>

  </div>

</template>

