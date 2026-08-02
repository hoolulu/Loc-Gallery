export function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0 || !Number.isFinite(sec)) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const RESUME_MIN_SEC = 15
const RESUME_END_MARGIN_SEC = 45

export function normalizeResumePosition(pos: number, durationSec?: number | null): number | null {
  if (!Number.isFinite(pos) || pos < RESUME_MIN_SEC) return null
  if (durationSec != null && durationSec > 0 && pos >= durationSec - RESUME_END_MARGIN_SEC) return null
  return pos
}

export function getSavedPosition(
  playPosition?: number,
  playDuration?: number,
  enabled = true,
): number | null {
  if (!enabled) return null
  return normalizeResumePosition(Number(playPosition), playDuration)
}

const FORMAT_BADGE_LABELS: Record<string, string> = {
  special: '特殊',
  remuxable: '可修复',
  interleaved: '交错',
  disguised: '伪装',
  fragmented: '碎片化',
  unsupported: '无法播放',
  hls: 'HLS',
  moov_end: '慢起播',
  large: '大文件',
  transcode: '特殊',
}

export function formatBadgeLabel(kind?: string | null): string {
  if (!kind) return ''
  const key = kind.toLowerCase()
  return FORMAT_BADGE_LABELS[key] ?? kind
}
