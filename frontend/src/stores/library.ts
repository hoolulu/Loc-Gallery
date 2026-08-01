import { defineStore } from 'pinia'
import { ref } from 'vue'
import { activateLibrary, getLibraries } from '@/api'
import { setActiveLibraryId } from '@/api/client'
import type { Library } from '@/types'

export const useLibraryStore = defineStore('library', () => {
  const libraries = ref<Library[]>([])
  const activeLibraryId = ref<string | null>(null)
  const loading = ref(false)

  async function loadLibraries() {
    loading.value = true
    try {
      const data = await getLibraries()
      libraries.value = data.items
      activeLibraryId.value = data.active_library_id
      setActiveLibraryId(data.active_library_id)
    } finally {
      loading.value = false
    }
  }

  async function switchLibrary(id: string) {
    const data = await activateLibrary(id)
    activeLibraryId.value = data.active_library_id
    setActiveLibraryId(data.active_library_id)
  }

  return { libraries, activeLibraryId, loading, loadLibraries, switchLibrary }
})
