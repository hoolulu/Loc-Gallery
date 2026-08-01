<script setup lang="ts">

import { onMounted, onUnmounted } from 'vue'

import { useRoute, useRouter } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'

import VideoCard from '@/components/gallery/VideoCard.vue'

import { useGalleryPlay } from '@/composables/useGalleryPlay'

import { removeVideosFromAlbum, setAlbumCover } from '@/api/albums'

import { useAlbumStore } from '@/stores/album'

import { useGalleryStore } from '@/stores/gallery'

import { useLibraryStore } from '@/stores/library'

import { useUiStore } from '@/stores/ui'



const route = useRoute()

const router = useRouter()

const album = useAlbumStore()

const gallery = useGalleryStore()

const library = useLibraryStore()

const ui = useUiStore()

const { onPlay, onToggleFavorite } = useGalleryPlay()



onMounted(async () => {
  document.addEventListener('lg-context-action', onContextAction)
  const id = route.params.id as string
  if (!library.activeLibraryId) await library.loadLibraries()
  await album.loadAlbum(id)
  gallery.viewMode = 'album-detail'
  gallery.albumId = id
  gallery.category = null
  gallery.page = 1
  await gallery.loadVideos()
})

onUnmounted(() => {
  document.removeEventListener('lg-context-action', onContextAction)
})



async function playAll() {

  if (!gallery.videos.length) return

  await onPlay(gallery.videos[0].id)

}



async function removeFromAlbum(id: string) {

  const albumId = route.params.id as string

  if (!confirm('从专辑中移除此视频？')) return

  await removeVideosFromAlbum(albumId, [id])

  await gallery.loadVideos()

  await album.loadAlbum(albumId)

}



function onVideoContext(e: MouseEvent, videoId: string) {

  ui.showContextMenu(

    e,

    [

      { label: '播放', action: 'play' },

      { label: '设为封面', action: 'set-cover' },
      { label: '从专辑移除', action: 'remove', danger: true },

    ],

    { targetId: videoId, targetType: 'video' },

  )

}



async function onContextAction(ev: Event) {

  const detail = (ev as CustomEvent).detail as { action: string; targetId?: string }

  const id = detail.targetId

  if (!id) return

  if (detail.action === 'play') await onPlay(id)

  else if (detail.action === 'remove') await removeFromAlbum(id)
  else if (detail.action === 'set-cover') {
    const albumId = route.params.id as string
    await setAlbumCover(albumId, id)
    await album.loadAlbum(albumId)
    ui.showToast('封面已更新')
  }
}

</script>



<template>

  <div class="flex h-full min-h-0 flex-col">

    <AppHeader />

    <main class="flex-1 overflow-y-auto p-4">

      <button class="mb-4 text-sm text-[var(--lg-text-muted)] hover:text-[var(--lg-text-primary)]" @click="router.push('/albums')">

        ← 返回专辑列表

      </button>

      <div class="mb-4 flex items-center gap-4">

        <div>

          <h2 class="text-xl font-medium">{{ album.currentAlbum?.name }}</h2>

          <p class="text-sm text-[var(--lg-text-muted)]">

            {{ album.currentAlbum?.video_count }} 个视频

            <span v-if="album.currentAlbum?.total_duration_sec">

              · {{ Math.floor((album.currentAlbum.total_duration_sec || 0) / 60) }} 分钟

            </span>

          </p>

        </div>

        <button

          class="ml-auto rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)]"

          @click="playAll"

        >

          播放全部

        </button>

      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">

        <VideoCard

          v-for="video in gallery.videos"

          :key="video.id"

          :video="video"

          @play="onPlay"

          @toggle-favorite="onToggleFavorite"

          @contextmenu="onVideoContext($event, video.id)"

        />

      </div>

    </main>

  </div>

</template>

