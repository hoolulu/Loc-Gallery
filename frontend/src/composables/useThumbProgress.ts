import { computed, ref } from 'vue'
import { getThumbStatus, getDurationStatus, pauseThumbs, resumeThumbs } from '@/api/thumbs'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'

export type ThumbProgressBarMode = 'auto' | 'always' | 'never'

type ThumbProgress = Record<string, unknown>
type DurationStatus = Record<string, unknown>

const thumbProgress = ref<ThumbProgress | null>(null)
const durationStatus = ref<DurationStatus | null>(null)
const userDismissed = ref(false)
const manualExpand = ref(false)

export function normalizeThumbProgressBar(mode: string | undefined): ThumbProgressBarMode {
  const m = (mode || 'auto').trim().toLowerCase()
  if (m === 'always' || m === 'never') return m
  return 'auto'
}

function computePageThumbStats() {
  const gallery = useGalleryStore()
  const items = gallery.videos
  let ready = 0
  let generating = 0
  let queued = 0
  let missing = 0
  for (const v of items) {
    if (v.thumbReady || v.thumbStatus === 'ready') ready += 1
    else if (v.thumbStatus === 'generating') generating += 1
    else if (v.thumbStatus === 'failed') {
      /* counted separately */
    } else missing += 1
  }
  return { total: items.length, ready, generating, queued, missing }
}

function isPageThumbActive() {
  const gallery = useGalleryStore()
  if (!gallery.videos.length) return false
  const s = computePageThumbStats()
  return s.generating + s.queued + s.missing > 0
}

function isThumbProgressIdle(global: ThumbProgress | null) {
  if (!global) return !isPageThumbActive()
  const failCount = (global.failed as number) ?? 0
  if (failCount > 0) return false
  if (global.paused) return false
  const generating = (global.generating as number) ?? 0
  const queueSize = (global.queue_size as number) ?? 0
  if (generating > 0 || queueSize > 0) return false
  if (!global.idle_scan) return !isPageThumbActive()
  if (((global.missing as number) ?? 0) > 0) return false
  const notReady = Math.max(0, ((global.total as number) ?? 0) - ((global.ready as number) ?? 0))
  return notReady === 0
}

function isDurationWorkActive(st: DurationStatus | null) {
  if (!st) return false
  if (((st.pending as number) ?? 0) > 0) return true
  if (((st.queued as number) ?? 0) > 0) return true
  if (((st.probing as number) ?? 0) > 0) return true
  if (((st.remaining as number) ?? 0) > 0) return true
  return false
}

function formatDurationProgressText(st: DurationStatus | null) {
  if (!st) return '时长探测: 加载中…'
  if (st.fallback) {
    return `当前页时长补全 ${st.cached}/${st.total} (${st.percent ?? 0}%)`
  }
  const remaining = Math.max(0, ((st.remaining as number) ?? (st.pending as number)) ?? 0)
  const workersTotal = (st.workers_total as number) ?? (st.worker_count as number) ?? 2
  const workersActive = (st.workers_active as number) ?? (st.probing as number) ?? 0
  const rate = Number(st.rate_per_min) || 0
  let detail = ` | 剩余 ${remaining}`
  if (rate > 0) {
    detail += ` · 约 ${rate} 个/分钟`
    const etaMin = Math.ceil(remaining / rate)
    if (etaMin > 0 && etaMin < 9999) detail += ` · 预计 ${etaMin} 分钟`
  }
  detail += ` · ffprobe ${workersTotal} 路并行`
  if (workersActive > 0) {
    detail += `（${workersActive} 路 ffprobe 运行中）`
  }
  const skipPart = st.skipped ? ` · 跳过 ${st.skipped}（下载中/不可处理）` : ''
  return `时长探测 ${st.cached ?? 0}/${st.total ?? 0} (${st.percent ?? 0}%)${detail}${skipPart}`
}

export function useThumbProgress() {
  const settings = useSettingsStore()
  const gallery = useGalleryStore()

  const mode = computed(() =>
    normalizeThumbProgressBar(settings.settings?.thumb_progress_bar),
  )

  const thumbIdle = computed(() => isThumbProgressIdle(thumbProgress.value))
  const durationBusy = computed(() => isDurationWorkActive(durationStatus.value))

  const showBar = computed(() => {
    if (mode.value === 'always') return true
    if (mode.value === 'never') return durationBusy.value
    if (!thumbIdle.value || durationBusy.value) return !userDismissed.value
    return manualExpand.value
  })

  const showThumbChip = computed(() => mode.value === 'auto')

  const thumbDotClass = computed(() => {
    const g = thumbProgress.value
    const failCount = (g?.failed as number) ?? 0
    if (failCount > 0) return 'thumb-status-dot--fail'
    if (!thumbIdle.value) return 'thumb-status-dot--busy'
    return 'thumb-status-dot--ok'
  })

  const thumbChipTitle = computed(() => {
    if (!thumbIdle.value && userDismissed.value) return '缩略图生成中，点击展开进度'
    if (showBar.value) return '点击收起缩略图进度'
    return '缩略图状态，点击展开详情'
  })

  const progressText = computed(() => {
    const g = thumbProgress.value
    const page = computePageThumbStats()
    if (g?.total) {
      const pagePart = page.total ? ` | 当前页 ${page.ready}/${page.total}` : ''
      let text =
        `全库 ${g.ready}/${g.total} (${g.percent}%)${pagePart}` +
        ` | 队列 ${g.queue_size ?? 0} | 生成中 ${g.generating ?? 0}` +
        ` | 未开始 ${g.missing ?? 0}`
      if (!thumbIdle.value && isPageThumbActive()) text += ' · 当前页生成中'
      return text
    }
    if (isPageThumbActive()) return `当前页 ${page.ready}/${page.total} · 缩略图生成中…`
    return '缩略图: 加载中…'
  })

  const durationHint = computed(() => {
    const st = durationStatus.value
    if (st?.fallback) {
      return '当前仅显示本页进度。请运行 python restart.py 加载新版服务后，可查看全库时长探测进度。'
    }
    return '后台用 ffprobe 逐条探测（默认 2 路并行，大文件单次可能较慢）；结果写入缩略图索引，已有播放记录会先复用。'
  })

  async function refresh() {
    const [thumb, duration] = await Promise.all([getThumbStatus(), getDurationStatus()])
    thumbProgress.value = thumb
    durationStatus.value = duration
  }

  async function togglePause() {
    if (thumbProgress.value?.paused) await resumeThumbs()
    else await pauseThumbs()
    thumbProgress.value = await getThumbStatus()
  }

  function toggleBar() {
    if (mode.value !== 'auto') return
    if (!thumbIdle.value || durationBusy.value) {
      userDismissed.value = !userDismissed.value
    } else {
      manualExpand.value = !manualExpand.value
    }
  }

  function resetDismiss() {
    userDismissed.value = false
    manualExpand.value = false
  }

  return {
    thumbProgress,
    durationStatus,
    mode,
    showBar,
    showThumbChip,
    thumbDotClass,
    thumbChipTitle,
    progressText,
    durationHint,
    durationBusy,
    thumbIdle,
    formatDurationProgressText,
    refresh,
    togglePause,
    toggleBar,
    resetDismiss,
    isPageThumbActive: () => isPageThumbActive(),
    gallery,
  }
}
