export interface Library {
  id: string
  alias: string
  path: string
  created_at: number
  order: number
  exists?: boolean
}

export interface LibrariesResponse {
  active_library_id: string
  items: Library[]
}

export interface Category {
  name: string
  count: number
  starred?: boolean
  has_subfolders?: boolean
}

export interface FolderNode {
  name: string
  path: string
  count: number
  total: number
  children?: FolderNode[]
}

export interface FolderTreeResponse {
  folders: FolderNode[]
}

export interface CategoriesResponse {
  items: Category[]
  sort_mode: string
}

export interface Video {
  id: string
  title: string
  filename: string
  path: string
  category: string
  subfolder: string
  size: number
  mtime: number
  thumbStatus: 'ready' | 'missing' | 'generating' | 'failed'
  thumbReady: boolean
  thumbError?: string
  thumbVersion: number
  favorited: boolean
  favoritedAt?: number
  playedAt?: number
  playCount: number
  playPosition: number
  playDuration: number
  durationSec?: number
  albumIds: string[]
  formatBadge?: string
}

export interface VideosResponse {
  items: Video[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  view?: string
  album_id?: string
  library_id?: string
}

export interface PlayInfo {
  id: string
  title: string
  mode: 'direct' | 'hls' | 'external' | 'unsupported'
  remuxable: boolean
  playPosition: number
  codec?: string
  structure?: { kind?: string; size_bytes?: number }
  reason?: string
  transcode?: boolean
  experimental_direct?: boolean
  cached?: boolean
  path?: string
  filename?: string
  playDuration?: number
}

export interface Album {
  id: string
  name: string
  description: string
  cover_video_id?: string
  video_count: number
  total_duration_sec?: number
  created_at: number
  updated_at: number
}

export interface Settings {
  thumb_position: number
  thumb_workers: number
  thumb_idle_scan: boolean
  thumb_progress_bar: 'auto' | 'always' | 'never'
  thumb_candidate_count?: number
  thumb_auto_select_best?: boolean
  thumb_batch_auto_select?: boolean
  thumb_jitter_pct?: number
  thumb_jitter_min?: number
  thumb_jitter_max?: number
  default_page_size: number
  potplayer_path: string
  player_mode: 'html5' | 'potplayer' | 'smart'
  history_retention_days: number
  hls_large_h264: boolean
  hls_moov_end_h264: boolean
  html5_fragmented_mp4: string
  html5_playlist_autoplay: boolean
  html5_resume_playback: boolean
  html5_wheel_seek_sec: number
  html5_modern_codecs_direct: boolean
  html5_player_prev_key: string
  html5_player_next_key: string
  ui_theme: 'dark' | 'light'
  ui_preset?: 'netflix' | 'youtube' | 'spotify'
  [key: string]: unknown
}

export const FORMAT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部格式' },
  { value: 'remuxable', label: '多段交错·可修复' },
  { value: 'transcode', label: '需转码' },
  { value: 'hls', label: 'HLS 边切' },
  { value: 'interleaved', label: '多段交错' },
  { value: 'disguised', label: '伪装格式' },
  { value: 'moov_end', label: '索引在末尾' },
  { value: 'large', label: '大文件' },
  { value: 'fragmented', label: '碎片化' },
  { value: 'unsupported', label: '无法播放' },
  { value: 'non_standard', label: '任意非标准' },
]

export type ViewMode = 'browse' | 'favorites' | 'history' | 'albums' | 'album-detail'
export type SortMode =
  | 'page'
  | 'random'
  | 'filename_asc'
  | 'filename_desc'
  | 'title_asc'
  | 'title_desc'
  | 'mtime_desc'
  | 'mtime_asc'
  | 'size_desc'
  | 'size_asc'
