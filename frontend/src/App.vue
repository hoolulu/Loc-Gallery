<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useSSE } from '@/composables/useSSE'
import { useSettingsStore } from '@/stores/settings'
import PlayerView from '@/components/player/PlayerView.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import NonstandardDialog from '@/components/dialogs/NonstandardDialog.vue'
import AlbumPickerDialog from '@/components/dialogs/AlbumPickerDialog.vue'
import ThumbFailedDialog from '@/components/dialogs/ThumbFailedDialog.vue'
import ThumbPickerDialog from '@/components/dialogs/ThumbPickerDialog.vue'
import FolderMoveDialog from '@/components/dialogs/FolderMoveDialog.vue'
import ContextMenu from '@/components/layout/ContextMenu.vue'
import PathTip from '@/components/layout/PathTip.vue'
import { setupVideoContextActions } from '@/composables/useVideoContextActions'
import { useRoute } from 'vue-router'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useUiStore } from '@/stores/ui'
import { getThumbStatus, getDurationStatus, pauseThumbs, resumeThumbs } from '@/api/thumbs'

const settings = useSettingsStore()
const ui = useUiStore()
const gallery = useGalleryStore()
const library = useLibraryStore()
const player = usePlayerStore()
const route = useRoute()
const thumbProgress = ref<Record<string, unknown> | null>(null)
const durationStatus = ref<Record<string, unknown> | null>(null)

setupVideoContextActions()

const { connect, disconnect } = useSSE(
  () => {},
  async () => {
    thumbProgress.value = await getThumbStatus()
    durationStatus.value = await getDurationStatus()
  },
)

watch(
  () => library.activeLibraryId,
  (id, prev) => {
    if (prev && id && id !== prev) {
      disconnect()
      connect()
    }
  },
)

onMounted(() => {
  connect()
  void settings.loadSettings()
  void getThumbStatus().then((d) => {
    thumbProgress.value = d
  })
  void getDurationStatus().then((d) => {
    durationStatus.value = d
  })
  document.addEventListener('keydown', onGlobalKeydown)
})

watch(
  () => ui.manageMode,
  (v) => document.body.classList.toggle('manage-mode', v),
  { immediate: true },
)

watch(
  () => ui.selectedCount,
  (n) => document.body.classList.toggle('has-selection', n > 0),
  { immediate: true },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (e.key === '/' && !inInput && !player.open) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus()
    return
  }
  if (e.key === 'Escape' && inInput && target.matches('[data-testid="search-input"]')) {
    gallery.query = ''
    gallery.page = 1
    void gallery.loadVideos()
    ;(target as HTMLInputElement).blur()
    return
  }
  if (player.open || inInput) return
  if (route.name === 'browse' && gallery.totalPages > 1) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (gallery.page > 1) {
        gallery.page -= 1
        void gallery.loadVideos()
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (gallery.page < gallery.totalPages) {
        gallery.page += 1
        void gallery.loadVideos()
      }
    }
  }
}

async function toggleThumbPause() {
  if (thumbProgress.value?.paused) await resumeThumbs()
  else await pauseThumbs()
  thumbProgress.value = await getThumbStatus()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <RouterView />
  </div>

  <PlayerView />
  <SettingsDialog />
  <NonstandardDialog />
  <AlbumPickerDialog />
  <ThumbFailedDialog />
  <ThumbPickerDialog />
  <FolderMoveDialog />
  <ContextMenu />
  <PathTip />

  <div v-if="ui.toast" class="lg-toast">
    {{ ui.toast.message }}
  </div>

  <div
    v-if="thumbProgress && (thumbProgress.total as number) > 0"
    class="fixed bottom-4 left-4 z-[50] max-w-sm rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] text-xs shadow-lg"
  >
    <button
      class="flex w-full items-center justify-between gap-2 p-3"
      @click="ui.thumbProgressExpanded = !ui.thumbProgressExpanded"
    >
      <span>
        缩略图: {{ thumbProgress.ready }}/{{ thumbProgress.total }}
        ({{ thumbProgress.percent }}%)
      </span>
      <span>{{ ui.thumbProgressExpanded ? '▼' : '▶' }}</span>
    </button>
    <div v-if="ui.thumbProgressExpanded" class="border-t border-[var(--lg-border)] px-3 pb-3">
      <div class="mb-2 h-1 overflow-hidden rounded bg-[var(--lg-bg-hover)]">
        <div
          class="h-full bg-[var(--lg-accent)]"
          :style="{ width: `${thumbProgress.percent || 0}%` }"
        />
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-[var(--lg-border)] px-2 py-0.5" @click="toggleThumbPause">
          {{ thumbProgress.paused ? '继续' : '暂停' }}
        </button>
        <button
          v-if="(thumbProgress.failed as number) > 0"
          class="rounded border border-[var(--lg-border)] px-2 py-0.5"
          @click="ui.thumbFailedOpen = true"
        >
          失败 {{ thumbProgress.failed }}
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="durationStatus && (durationStatus.pending as number) > 0"
    class="fixed bottom-4 left-72 z-[50] rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] px-3 py-2 text-xs shadow-lg"
  >
    时长探测: {{ durationStatus.done }}/{{ durationStatus.total }}
  </div>
</template>
