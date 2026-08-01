import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createAlbum, deleteAlbum, getAlbum, getAlbums, updateAlbum } from '@/api/albums'
import type { Album } from '@/types'

export const useAlbumStore = defineStore('album', () => {
  const albums = ref<Album[]>([])
  const currentAlbum = ref<(Album & { total_duration_sec?: number }) | null>(null)
  const loading = ref(false)

  async function loadAlbums() {
    loading.value = true
    try {
      const data = await getAlbums()
      albums.value = data.items
    } finally {
      loading.value = false
    }
  }

  async function loadAlbum(id: string) {
    loading.value = true
    try {
      currentAlbum.value = await getAlbum(id)
    } finally {
      loading.value = false
    }
  }

  async function addAlbum(name: string, description = '') {
    const data = await createAlbum(name, description)
    await loadAlbums()
    return data.album
  }

  async function editAlbum(id: string, patch: Partial<Album>) {
    await updateAlbum(id, patch)
    await loadAlbums()
    if (currentAlbum.value?.id === id) await loadAlbum(id)
  }

  async function removeAlbum(id: string) {
    await deleteAlbum(id)
    if (currentAlbum.value?.id === id) currentAlbum.value = null
    await loadAlbums()
  }

  return { albums, currentAlbum, loading, loadAlbums, loadAlbum, addAlbum, editAlbum, removeAlbum }
})
