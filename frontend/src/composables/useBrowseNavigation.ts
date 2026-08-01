import { useRouter } from 'vue-router'
import { DEFAULT_GALLERY_SORT, useGalleryStore } from '@/stores/gallery'
import type { SortMode } from '@/types'

/** 同步浏览状态到 URL（全部分类时不写 cat 参数） */
export function useBrowseNavigation() {
  const gallery = useGalleryStore()
  const router = useRouter()

  function syncUrl() {
    const q: Record<string, string> = {}
    if (gallery.category) q.cat = gallery.category
    if (gallery.folder) q.folder = gallery.folder
    if (gallery.page > 1) q.page = String(gallery.page)
    if (gallery.sort !== DEFAULT_GALLERY_SORT) q.sort = gallery.sort
    if (gallery.query) q.q = gallery.query
    if (gallery.formatFilter) q.format = gallery.formatFilter
    void router.replace({ query: q })
  }

  function applyRouteQuery(hasCatKey: boolean, hasFolderKey: boolean) {
    const q = router.currentRoute.value.query
    if (hasCatKey) {
      gallery.category = typeof q.cat === 'string' && q.cat ? q.cat : null
    }
    if (hasFolderKey) {
      gallery.folder = typeof q.folder === 'string' && q.folder ? q.folder : null
    }
    if (typeof q.page === 'string') gallery.page = Number(q.page) || 1
    if (typeof q.sort === 'string') gallery.sort = q.sort as SortMode
    if (typeof q.q === 'string') gallery.query = q.q
    if (typeof q.format === 'string') gallery.formatFilter = q.format
  }

  async function selectCategory(name: string | null) {
    gallery.viewMode = 'browse'
    gallery.setCategory(name)
    if (name) await gallery.loadFolderTree(name)
    await gallery.loadVideos()
    syncUrl()
  }

  async function selectFolder(cat: string, path: string) {
    gallery.viewMode = 'browse'
    gallery.setCategory(cat)
    gallery.setFolder(path)
    await gallery.loadVideos()
    syncUrl()
  }

  return { syncUrl, applyRouteQuery, selectCategory, selectFolder }
}
