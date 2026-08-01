import { onUnmounted, ref } from 'vue'
import { useGalleryStore } from '@/stores/gallery'
import { useLibraryStore } from '@/stores/library'

let versionDebounce: ReturnType<typeof setTimeout> | null = null
let lastVersion = ''

export function useSSE(onVersion?: () => void, onProgress?: () => void) {
  const connected = ref(false)
  let es: EventSource | null = null
  const gallery = useGalleryStore()
  const library = useLibraryStore()

  function connect() {
    es?.close()
    const libQ = library.activeLibraryId
      ? `?library_id=${encodeURIComponent(library.activeLibraryId)}`
      : ''
    es = new EventSource(`/api/events${libQ}`)
    connected.value = true

    es.onmessage = (e) => {
      const colon = e.data.indexOf(':')
      const type = colon >= 0 ? e.data.slice(0, colon) : e.data
      const payload = colon >= 0 ? e.data.slice(colon + 1) : ''
      if (type === 'version') {
        const parts = payload.split(':')
        const lid = parts.length > 1 ? parts[0] : ''
        const ver = parts.length > 1 ? parts.slice(1).join(':') : payload
        if (lid && lid !== library.activeLibraryId) return
        if (versionDebounce) clearTimeout(versionDebounce)
        versionDebounce = setTimeout(async () => {
          const changed = ver && ver !== lastVersion
          lastVersion = ver
          await gallery.loadCategories()
          if (changed) await gallery.loadVideos()
          onVersion?.()
        }, 500)
      } else if (type === 'progress') {
        onProgress?.()
      }
    }

    es.onerror = () => {
      es?.close()
      es = null
      connected.value = false
      setTimeout(connect, 5000)
    }
  }

  function disconnect() {
    es?.close()
    es = null
    connected.value = false
  }

  onUnmounted(disconnect)

  return { connected, connect, disconnect }
}
