import type { SortMode } from '@/types'

export interface SortOption {
  value: SortMode
  label: string
}

/** 画廊排序（9 种，不含 page） */
export const GALLERY_SORT_OPTIONS: SortOption[] = [
  { value: 'mtime_desc', label: '最新优先' },
  { value: 'mtime_asc', label: '最旧优先' },
  { value: 'title_asc', label: '标题 A-Z' },
  { value: 'title_desc', label: '标题 Z-A' },
  { value: 'size_desc', label: '体积最大' },
  { value: 'size_asc', label: '体积最小' },
  { value: 'random', label: '随机列表' },
  { value: 'filename_asc', label: '文件名 A-Z' },
  { value: 'filename_desc', label: '文件名 Z-A' },
]

/** 播放列表排序（列表顺序 + 9 种） */
export const PLAYLIST_SORT_OPTIONS: SortOption[] = [
  { value: 'page', label: '列表顺序' },
  { value: 'random', label: '随机' },
  ...GALLERY_SORT_OPTIONS.filter((o) => o.value !== 'random'),
]
