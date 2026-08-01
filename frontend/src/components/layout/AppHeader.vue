<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore, type ThemePreset } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useAlbumStore } from '@/stores/album'
import { rescan } from '@/api'

const route = useRoute()
const gallery = useGalleryStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const ui = useUiStore()
const album = useAlbumStore()

const navItems = [
  { name: 'browse', label: '首页', to: '/' },
  { name: 'favorites', label: '我的收藏', to: '/favorites' },
  { name: 'history', label: '最近播放', to: '/history' },
  { name: 'albums', label: '我的专辑', to: '/albums' },
]

const presetOptions: { value: ThemePreset; label: string }[] = [
  { value: 'netflix', label: '影院' },
  { value: 'youtube', label: '经典' },
]

const activeNav = computed(() => route.name)

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function onSearchInput(e: Event) {
  gallery.query = (e.target as HTMLInputElement).value
  gallery.page = 1
  gallery.regenerateRandomSeedIfNeeded()
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => gallery.loadVideos(), 300)
}

async function onLibraryChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  await library.switchLibrary(id)
  gallery.clearFolderCaches()
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  await gallery.loadCategories()
  await gallery.loadVideos()
  await album.loadAlbums()
}

async function onRescan() {
  await rescan()
  await gallery.loadCategories()
  await gallery.loadVideos()
  ui.showToast('扫描完成')
}

async function onPresetChange(p: ThemePreset) {
  await settings.setPreset(p)
  ui.showToast(`已切换为 ${p} 主题`)
}
</script>

<template>
  <header class="app-header shrink-0 border-b border-[var(--lg-border)] bg-[var(--lg-bg-header)]">
    <div class="app-header-main">
      <div class="app-header-left">
        <h1 class="app-header-logo">
          <span class="text-[var(--lg-accent)]">Loc</span> Gallery
        </h1>
      </div>

      <nav class="app-header-nav" aria-label="主视图">
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          class="app-header-nav-link"
          :class="{ active: activeNav === item.name }"
        >
          {{ item.label }}
        </router-link>
        <div class="app-header-library">
          <span class="text-xs text-[var(--lg-text-muted)]">视频库</span>
          <select
            class="rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-2 py-1 text-sm"
            :value="library.activeLibraryId || ''"
            @change="onLibraryChange"
          >
            <option v-for="lib in library.libraries" :key="lib.id" :value="lib.id">
              {{ lib.alias }}
            </option>
          </select>
        </div>
      </nav>

      <div class="app-header-right">
        <div class="flex overflow-hidden rounded border border-[var(--lg-border)] text-xs" title="界面主题">
          <button
            v-for="p in presetOptions"
            :key="p.value"
            class="px-2.5 py-1.5 transition"
            :class="
              settings.preset === p.value
                ? 'bg-[var(--lg-accent)] text-[var(--lg-text-on-accent)]'
                : 'bg-[var(--lg-bg-secondary)] text-[var(--lg-text-secondary)] lg-hover'
            "
            @click="onPresetChange(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
        <input
          data-testid="search-input"
          type="search"
          placeholder="搜索"
          class="app-header-search rounded border border-[var(--lg-border)] bg-[var(--lg-bg-input)] px-3 py-1.5 text-sm"
          :value="gallery.query"
          @input="onSearchInput"
        />
        <button
          class="rounded border px-3 py-1.5 text-sm"
          :class="ui.manageMode ? 'border-[var(--lg-accent)] text-[var(--lg-accent)]' : 'border-[var(--lg-border)]'"
          @click="ui.manageMode = !ui.manageMode; if (!ui.manageMode) ui.clearSelection()"
        >
          批量
        </button>
        <button
          class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover"
          :title="settings.theme === 'dark' ? '切换亮色' : '切换暗色'"
          @click="settings.toggleTheme()"
        >
          {{ settings.theme === 'dark' ? '☾' : '☀' }}
        </button>
        <button class="rounded border border-[var(--lg-border)] px-3 py-1.5 text-sm lg-hover" @click="ui.settingsOpen = true">
          设置
        </button>
        <button
          class="rounded border border-[var(--lg-accent)] px-3 py-1.5 text-sm text-[var(--lg-accent)] hover:bg-[var(--lg-accent-muted)]"
          @click="onRescan"
        >
          刷新
        </button>
      </div>
    </div>
  </header>
</template>
