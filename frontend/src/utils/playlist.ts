import type { SortMode, ViewMode } from '@/types'

export interface PlaylistContext {
  category: string | null
  folder: string | null
  query: string
  formatFilter: string
  viewMode: ViewMode
  albumId: string | null
  pageSize: number
}

export function buildPlaylistParams(
  ctx: PlaylistContext,
  page: number,
  sort: SortMode,
  randomSeed: number | null,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    page,
    page_size: ctx.pageSize,
    sort,
  }
  if (ctx.category) params.category = ctx.category
  if (ctx.folder) params.folder = ctx.folder
  if (ctx.query.trim()) params.q = ctx.query.trim()
  if (ctx.formatFilter) params.format = ctx.formatFilter
  if (ctx.viewMode === 'favorites') params.favorites = true
  if (ctx.viewMode === 'history') params.history = true
  if (ctx.viewMode === 'album-detail' && ctx.albumId) params.album_id = ctx.albumId
  if (sort === 'random' && randomSeed != null) params.seed = randomSeed
  return params
}
