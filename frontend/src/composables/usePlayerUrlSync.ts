import { useRoute, useRouter } from 'vue-router'

export function usePlayerUrlSync() {
  const route = useRoute()
  const router = useRouter()

  function setPlayInUrl(id: string | null) {
    const q = { ...route.query }
    if (id) q.play = id
    else delete q.play
    void router.replace({ query: q })
  }

  function playIdFromUrl(): string | null {
    const p = route.query.play
    return typeof p === 'string' && p ? p : null
  }

  return { setPlayInUrl, playIdFromUrl }
}
