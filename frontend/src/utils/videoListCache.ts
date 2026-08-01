import type { Video } from '@/types'

const CACHE_KEY = 'loc-gallery-video-page-cache'
const MAX_AGE_MS = 10 * 60 * 1000

export interface VideoListCacheEntry {
  key: string
  items: Video[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  savedAt: number
}

export function buildVideoListCacheKey(params: Record<string, string | number | boolean>) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}

export function readVideoListCache(key: string): VideoListCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VideoListCacheEntry
    if (parsed.key !== key) return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function writeVideoListCache(
  key: string,
  data: Pick<VideoListCacheEntry, 'items' | 'total' | 'page' | 'pageSize' | 'totalPages'>,
) {
  try {
    const entry: VideoListCacheEntry = {
      key,
      items: data.items,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: data.totalPages,
      savedAt: Date.now(),
    }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* quota / private mode */
  }
}

export function clearVideoListCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}
