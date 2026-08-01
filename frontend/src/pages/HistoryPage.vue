<script setup lang="ts">
import { onMounted } from 'vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import VideoCard from '@/components/gallery/VideoCard.vue'
import { useGalleryPlay } from '@/composables/useGalleryPlay'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'

const gallery = useGalleryStore()
const library = useLibraryStore()
const { onPlay, onToggleFavorite } = useGalleryPlay()

onMounted(async () => {
  gallery.viewMode = 'history'
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  if (!library.activeLibraryId) await library.loadLibraries()
  await gallery.loadVideos()
})

async function changePage(next: number) {
  if (next < 1 || next > gallery.totalPages) return
  gallery.page = next
  await gallery.loadVideos()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppHeader />
    <main class="flex flex-1 flex-col overflow-hidden p-4">
      <h2 class="mb-4 shrink-0 text-lg font-medium">最近播放</h2>
      <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 overflow-y-auto pb-4">
        <VideoCard
          v-for="video in gallery.videos"
          :key="video.id"
          :video="video"
          show-play-count
          show-progress
          @play="onPlay"
          @toggle-favorite="onToggleFavorite"
        />
      </div>
      <div v-if="gallery.totalPages > 1" class="mt-2 flex shrink-0 items-center justify-center gap-3">
        <button
          class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm disabled:opacity-40"
          :disabled="gallery.page <= 1"
          @click="changePage(gallery.page - 1)"
        >
          上一页
        </button>
        <span class="text-sm">{{ gallery.page }} / {{ gallery.totalPages }}</span>
        <button
          class="rounded border border-[var(--lg-border)] px-3 py-1 text-sm disabled:opacity-40"
          :disabled="gallery.page >= gallery.totalPages"
          @click="changePage(gallery.page + 1)"
        >
          下一页
        </button>
      </div>
    </main>
  </div>
</template>
