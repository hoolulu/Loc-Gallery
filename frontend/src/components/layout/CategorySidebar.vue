<script setup lang="ts">

import { computed, onMounted, onUnmounted, ref } from 'vue'

import FolderTreeNode from './FolderTreeNode.vue'

import { deleteFolder, renameFolder, reorderCategories, setCategorySortMode } from '@/api/files'

import { useGalleryStore } from '@/stores/gallery'
import { useBrowseNavigation } from '@/composables/useBrowseNavigation'
import { useUiStore } from '@/stores/ui'



const gallery = useGalleryStore()

const ui = useUiStore()
const { selectCategory, selectFolder } = useBrowseNavigation()



const categorySortMode = ref('custom')

const dragFrom = ref<string | null>(null)



const totalCount = computed(() => gallery.categories.reduce((s, c) => s + c.count, 0))



const sortOptions = [

  { value: 'custom', label: '自定义' },

  { value: 'name_asc', label: '名称 A-Z' },

  { value: 'name_desc', label: '名称 Z-A' },

  { value: 'count_desc', label: '数量最多' },

  { value: 'count_asc', label: '数量最少' },

]



async function onCategoryClick(cat: { name: string; has_subfolders?: boolean }) {
  if (cat.has_subfolders) {
    gallery.toggleCategoryExpanded(cat.name)
    if (gallery.expandedCategories.has(cat.name)) {
      await gallery.loadFolderTree(cat.name)
    }
  }
  await selectCategory(cat.name)
}



function folderTree(cat: string) {

  return gallery.folderTrees[cat]?.folders || []

}



async function onSortModeChange(e: Event) {

  const mode = (e.target as HTMLSelectElement).value

  categorySortMode.value = mode

  await setCategorySortMode(mode)

  await gallery.loadCategories()

}



function onDragStart(name: string) {

  if (categorySortMode.value !== 'custom') return

  dragFrom.value = name

}



async function onDrop(target: string) {

  if (!dragFrom.value || dragFrom.value === target) return

  const order = gallery.categories.map((c) => c.name)

  const fromIdx = order.indexOf(dragFrom.value)

  const toIdx = order.indexOf(target)

  if (fromIdx < 0 || toIdx < 0) return

  order.splice(fromIdx, 1)

  order.splice(toIdx, 0, dragFrom.value)

  dragFrom.value = null

  await reorderCategories(order)

  await gallery.loadCategories()

}



function onFolderContext(e: MouseEvent, category: string, path: string) {
  e.stopPropagation()
  ui.showContextMenu(
    e,
    [
      { label: '打开', action: 'folder-open' },
      { label: '重命名', action: 'folder-rename' },
      { label: '移动到', action: 'folder-move' },
      { label: '删除', action: 'folder-delete', danger: true },
    ],
    { targetType: 'folder', payload: { category, path, folderType: 'subdir' } },
  )
}

function onCategoryContext(e: MouseEvent, catName: string) {
  e.stopPropagation()
  ui.showContextMenu(
    e,
    [
      { label: '重命名', action: 'folder-rename' },
      { label: '移动到', action: 'folder-move' },
      { label: '删除', action: 'folder-delete', danger: true },
    ],
    { targetType: 'folder', payload: { category: catName, path: catName, folderType: 'cat' } },
  )
}



async function onContextAction(ev: Event) {

  const detail = (ev as CustomEvent).detail as {
    action: string
    targetType?: string
    payload?: { category?: string; path?: string; folderType?: 'subdir' | 'cat' }
  }

  if (detail.targetType !== 'folder' || !detail.payload?.category || !detail.payload.path) return

  const { category, path, folderType = 'subdir' } = detail.payload

  if (detail.action === 'folder-open') {
    if (folderType !== 'subdir') return
    await selectFolder(category, path)

  } else if (detail.action === 'folder-rename') {

    const newName = prompt('新文件夹名称', path.split('/').pop() || '')

    if (newName) {

      await renameFolder(category, path, newName, folderType)

      gallery.clearFolderCaches()

      await gallery.loadCategories()

      if (gallery.category) await gallery.loadFolderTree(gallery.category)

      await gallery.loadVideos()

      ui.showToast('已重命名')

    }

  } else if (detail.action === 'folder-move') {
    ui.openFolderMove({ mode: 'folder', category, path, folderType })
  } else if (detail.action === 'folder-delete') {

    if (confirm(`确定删除文件夹「${path}」及其所有视频？`)) {

      await deleteFolder(category, path, folderType)

      gallery.clearFolderCaches()

      if (gallery.folder === path) gallery.setFolder(null)

      await gallery.loadCategories()

      await gallery.loadVideos()

      ui.showToast('已删除')

    }

  }

}



onMounted(() => {

  document.addEventListener('lg-context-action', onContextAction)

})



onUnmounted(() => {

  document.removeEventListener('lg-context-action', onContextAction)

})

</script>



<template>

  <aside class="browse-sidebar flex w-60 shrink-0 flex-col border-r border-[var(--lg-border)] bg-[var(--lg-bg-sidebar)]">

    <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-3 py-2">

      <span class="text-sm font-medium">分类</span>

      <select

        class="rounded border border-[var(--lg-border)] bg-transparent px-1 py-0.5 text-[10px]"

        :value="categorySortMode"

        @change="onSortModeChange"

      >

        <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>

      </select>

    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="category-list">

      <button

        class="mb-1 flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm transition lg-hover"
        :class="{ 'lg-active': !gallery.category }"

        @click="selectCategory(null)"

      >

        <span>全部</span>

        <span class="text-xs text-[var(--lg-text-muted)]">{{ totalCount }}</span>

      </button>



      <div

        v-for="cat in gallery.categories"

        :key="cat.name"

        class="mb-1"

        :draggable="categorySortMode === 'custom'"

        @dragstart="onDragStart(cat.name)"

        @dragover.prevent

        @drop="onDrop(cat.name)"

      >

        <button

          data-testid="category-item"

          class="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm transition lg-hover"
          :class="{ 'lg-active': gallery.category === cat.name && !gallery.folder }"

          @click="onCategoryClick(cat)"
          @contextmenu.prevent="onCategoryContext($event, cat.name)"

        >

          <span class="flex min-w-0 items-center gap-1">

            <span

              v-if="cat.has_subfolders"

              class="inline-block w-3 text-[10px] transition"

              :class="{ 'rotate-90': gallery.expandedCategories.has(cat.name) }"

            >▶</span>

            <span v-if="categorySortMode === 'custom'" class="cursor-grab text-[var(--lg-text-muted)]">⋮⋮</span>

            <span class="truncate">{{ cat.name }}</span>

          </span>

          <span class="ml-2 text-xs text-[var(--lg-text-muted)]">{{ cat.count }}</span>

        </button>



        <div

          v-if="cat.has_subfolders && gallery.expandedCategories.has(cat.name) && folderTree(cat.name).length"

          class="ml-2 border-l border-[var(--lg-border)] pl-1"

        >

          <FolderTreeNode

            v-for="node in folderTree(cat.name)"

            :key="node.path"

            :node="node"

            :category="cat.name"

            :depth="0"

            @select="selectFolder"

            @contextmenu="onFolderContext"

          />

        </div>

      </div>

    </div>

  </aside>

</template>

