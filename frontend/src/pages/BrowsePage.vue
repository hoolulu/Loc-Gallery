<script setup lang="ts">

import { computed, onMounted, ref, watch } from 'vue'

import { useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'

import CategorySidebar from '@/components/layout/CategorySidebar.vue'

import VirtualVideoGrid from '@/components/gallery/VirtualVideoGrid.vue'
import BrowsePagination from '@/components/gallery/BrowsePagination.vue'
import BatchActionBar from '@/components/layout/BatchActionBar.vue'

import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { useBrowseNavigation } from '@/composables/useBrowseNavigation'
import { showVideoContextMenu } from '@/composables/useVideoContextActions'

import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { scanFormat } from '@/api/thumbs'
import { FORMAT_FILTER_OPTIONS, type SortMode } from '@/types'
import { GALLERY_SORT_OPTIONS } from '@/constants/sort'
import { GRID_COLUMNS } from '@/constants/layout'



const router = useRouter()

const gallery = useGalleryStore()

const library = useLibraryStore()

const settings = useSettingsStore()

const { onPlay, onToggleFavorite, onRandomPlay } = useGalleryPlay()
const { syncUrl, applyRouteQuery, selectCategory } = useBrowseNavigation()

const customPageSize = ref('')
const sortOptions = GALLERY_SORT_OPTIONS
const skeletonCount = computed(() => Math.min(gallery.pageSize, 24))
const skeletonColumns = computed(() => GRID_COLUMNS[settings.preset])
const skeletonStyle = computed(() => ({
  gridTemplateColumns: `repeat(${skeletonColumns.value}, minmax(0, 1fr))`,
}))



const breadcrumb = computed(() => {

  if (!gallery.category) return ''

  let text = gallery.category

  if (gallery.folder) {

    text += ' / ' + gallery.folder.split('/').join(' / ')

  }

  return text

})





async function init() {
  gallery.viewMode = 'browse'
  gallery.restoreRandomSeed()
  gallery.restoreBrowseState()
  gallery.restoreSort()
  gallery.restorePageSize(settings.preset)

  applyRouteQuery(
    'cat' in router.currentRoute.value.query,
    'folder' in router.currentRoute.value.query,
  )

  const videosTask = gallery.loadVideos()
  void Promise.all([library.loadLibraries(), settings.loadSettings()]).then(() => {
    gallery.restorePageSize(settings.preset)
    void gallery.loadCategories()
    if (gallery.category) void gallery.loadFolderTree(gallery.category)
  })

  await videosTask
  syncUrl()
}

watch(
  () => settings.preset,
  async (preset) => {
    gallery.restorePageSize(preset)
    await gallery.loadVideos()
    syncUrl()
  },
)



onMounted(() => {

  void init()

})



async function onNetflixCategoryChange(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  await selectCategory(name || null)
}

async function onSortChange(e: Event) {

  gallery.setSort((e.target as HTMLSelectElement).value as SortMode)

  await gallery.loadVideos()

  syncUrl()

}



async function onFormatChange(e: Event) {

  gallery.setFormatFilter((e.target as HTMLSelectElement).value)

  if (gallery.formatFilter) void scanFormat()

  await gallery.loadVideos()

  syncUrl()

}



async function onPageSizeChange(size: number) {
  customPageSize.value = ''
  gallery.setPageSize(size, settings.preset)
  await gallery.loadVideos()
  syncUrl()
}

async function onCustomPageSize(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const n = parseInt(customPageSize.value, 10)
  if (!Number.isFinite(n) || n < 1) return
  gallery.setPageSize(n, settings.preset)
  await gallery.loadVideos()
  syncUrl()
}

async function changePage(next: number) {
  if (next < 1 || next > gallery.totalPages) return
  gallery.page = next
  await gallery.loadVideos()
  syncUrl()
}

async function onJumpPage(page: number) {
  await changePage(page)
}



function onVideoContext(e: MouseEvent, videoId: string) {
  showVideoContextMenu(e, videoId)
}

</script>



<template>

  <div class="flex h-full min-h-0 flex-col">

    <AppHeader />

    <div class="flex min-h-0 flex-1">
      <CategorySidebar v-if="settings.preset === 'youtube'" />

      <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">

        <div class="mb-2 shrink-0 text-sm text-[var(--lg-text-muted)]" v-if="breadcrumb">

          {{ breadcrumb }}

        </div>

        <div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <h2 class="text-lg font-medium">{{ gallery.category || '全部' }}</h2>
          <span class="text-sm text-[var(--lg-text-muted)]">共 {{ gallery.total }} 个</span>

          <select
            v-if="settings.preset === 'netflix'"
            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1 text-sm"
            :value="gallery.category || ''"
            @change="onNetflixCategoryChange"
          >
            <option value="">全部分类</option>
            <option v-for="cat in gallery.categories" :key="cat.name" :value="cat.name">
              {{ cat.name }} ({{ cat.count }})
            </option>
          </select>

          <select

            class="ml-auto rounded border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-2 py-1 text-sm"

            :value="gallery.formatFilter"

            @change="onFormatChange"

          >

            <option v-for="opt in FORMAT_FILTER_OPTIONS" :key="opt.value" :value="opt.value">

              {{ opt.label }}

            </option>

          </select>

          <select

            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-secondary)] px-2 py-1 text-sm"

            :value="gallery.sort"

            @change="onSortChange"

          >

            <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">

              {{ opt.label }}

            </option>

          </select>

          <button

            class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm lg-hover"

            @click="onRandomPlay"

          >

            随机播放

          </button>

        </div>



        <div
          v-if="gallery.loading && !gallery.videos.length"
          class="video-grid min-h-0 flex-1 grid gap-3 pb-4"
          :style="skeletonStyle"
        >
          <div
            v-for="n in skeletonCount"
            :key="n"
            class="gallery-skeleton-card"
          />
        </div>

        <VirtualVideoGrid
          v-else
          class="transition-opacity duration-150"
          :class="{ 'opacity-60 pointer-events-none': gallery.refreshing }"
          :videos="gallery.videos"
          @play="onPlay"
          @toggle-favorite="onToggleFavorite"
          @contextmenu="onVideoContext"
        />



        <BrowsePagination
          v-model:custom-page-size="customPageSize"
          class="shrink-0"
          @page-size-change="onPageSizeChange"
          @custom-page-size="onCustomPageSize"
          @change-page="changePage"
          @jump-page="onJumpPage"
        />



        <BatchActionBar />

      </main>

    </div>

  </div>

</template>

