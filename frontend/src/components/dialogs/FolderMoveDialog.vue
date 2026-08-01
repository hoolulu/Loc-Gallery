<script setup lang="ts">
import { computed, ref } from 'vue'
import { moveFolder, moveVideos } from '@/api/files'
import { useGalleryStore } from '@/stores/gallery'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const gallery = useGalleryStore()

const selectedDest = ref('')

const title = computed(() => {
  const p = ui.folderMovePayload
  if (!p) return '移动'
  if (p.mode === 'folder') return `移动文件夹「${p.path}」到：`
  return `移动 ${p.videoIds?.length || 0} 个视频到分类：`
})

const destinations = computed(() => {
  if (ui.folderMovePayload?.mode === 'videos') {
    return gallery.categories.map((c) => ({ path: c.name, label: c.name }))
  }
  const current = ui.folderMovePayload?.category || gallery.category || ''
  return [
    { path: '', label: '库根目录' },
    ...gallery.categories.filter((c) => c.name !== current).map((c) => ({ path: c.name, label: c.name })),
  ]
})

async function confirm() {
  const p = ui.folderMovePayload
  if (!p) return
  if (p.mode === 'folder' && p.category && p.path != null) {
    await moveFolder(p.category, p.path, selectedDest.value, p.folderType || 'subdir')
    gallery.clearFolderCaches()
    await gallery.loadCategories()
    if (gallery.category) await gallery.loadFolderTree(gallery.category)
    await gallery.loadVideos()
    ui.showToast('文件夹已移动')
  } else if (p.mode === 'videos' && p.videoIds?.length) {
    if (!selectedDest.value) {
      ui.showToast('请选择目标分类')
      return
    }
    await moveVideos(p.videoIds, selectedDest.value)
    await gallery.loadVideos()
    ui.showToast('视频已移动')
  }
  ui.closeFolderMove()
}

function close() {
  ui.closeFolderMove()
}
</script>

<template>
  <dialog
    v-if="ui.folderMoveOpen"
    open
    class="fixed inset-0 z-[260] m-auto w-full max-w-md rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] p-0 text-[var(--lg-text-primary)] shadow-2xl backdrop:bg-black/60"
  >
    <div class="border-b border-[var(--lg-border)] px-4 py-3">
      <h2 class="text-lg font-medium">{{ title }}</h2>
    </div>
    <div class="max-h-64 overflow-y-auto p-3">
      <button
        v-for="d in destinations"
        :key="d.path"
        class="mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm lg-hover"
        :class="{ 'lg-selected': selectedDest === d.path }"
        @click="selectedDest = d.path"
      >
        <span>📁</span>
        <span>{{ d.label }}</span>
      </button>
    </div>
    <div class="flex justify-end gap-2 border-t border-[var(--lg-border)] px-4 py-3">
      <button class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm" @click="close">取消</button>
      <button class="rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)]" @click="confirm">确定</button>
    </div>
  </dialog>
</template>
