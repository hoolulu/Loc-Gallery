import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { streamUrl } from '@/api/client'
import type { Video } from '@/types'

/**
 * 悬停多段视频预览（零预生成 / 零切片 / 后端零改动）。
 *
 * 预览画面挂载在悬停大图浮层（PathTip 的 .path-tip-preview）内：全局单实例原生
 * <video>（muted+playsinline）绝对定位覆盖预览区。预览区不再渲染缩略图，而是
 * 显示深色「加载中」占位（PathTip 渲染，placeholderLoading 状态驱动 spinner），
 * 视频就绪（play 成功）后在占位之上 500ms 淡入播放——视觉上是「区域亮起视频」，
 * 无缩略图→视频的内容替换感。直连 /api/stream/{id} 的 HTTP Range 流，每段只是
 * 把 currentTime 设到目标位置，浏览器自动拉该段附近 GOP 数据。
 * 蒙太奇段数与每段秒数由设置项 html5_hover_preview_segments / _segment_sec 控制
 * （默认 5 段 × 5 秒），段位在 15%~85% 区间均匀分布，播完循环，直到鼠标移开。
 *
 * 失败兜底：error / seek 超时（4s）→ 静默隐藏，不打断浏览、不弹错。
 */

// 段位区间（占全片比例，避开片头黑场/片尾字幕）
const RANGE_START = 0.15
const RANGE_END = 0.85
const JITTER = 0.03 // 首段位置随机抖动，避免每次看到同一画面
const START_DELAY = 220 // 悬停多久才启动（与浮层 220ms 节奏一致）
const STOP_DELAY = 150 // 移开后多久停止（防止跨卡片快速移动时闪烁）
const SEEK_TIMEOUT = 4000 // 单段 seek 超时兜底
const MOUNT_RETRIES = 40 // 等浮层渲染的最大重试次数（×50ms ≈ 2s，覆盖 metadata 就绪+渲染时序）
const MOUNT_RETRY_MS = 50

/** 在 15%~85% 区间均匀分布 N 个段位比例 */
function computePositions(count: number): number[] {
  const n = Math.max(1, Math.min(10, Math.round(count) || 1))
  if (n <= 1) return [RANGE_START]
  return Array.from({ length: n }, (_, i) => RANGE_START + ((RANGE_END - RANGE_START) * i) / (n - 1))
}

let video: HTMLVideoElement | null = null
let activeId = ''
let running = false
let pendingStart: ReturnType<typeof setTimeout> | null = null
let pendingStop: ReturnType<typeof setTimeout> | null = null
let seekTimer: ReturnType<typeof setTimeout> | null = null
let segTimer: ReturnType<typeof setTimeout> | null = null

/** 每次预览新建独立 <video>：复用元素切换 src 会残留缓冲/事件状态，
 *  导致"先预览别的视频再悬停此视频"时偶发黑屏。新建成本极低。
 *  所有事件回调必须校验「本元素仍是当前活动预览」：快速切换时旧元素的事件
 *  （尤其 playing）可能延迟到达，若误触发会提前显示新视频（黑屏）。 */
function createVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.className = 'hover-preview-video'
  v.muted = true
  v.playsInline = true
  v.preload = 'metadata'
  // 初始透明：加载/seek 阶段盖在 <img> 上不闪黑，play() 成功后才显示
  v.style.opacity = '0'
  v.addEventListener('error', () => {
    // 仅当前预览的错误才终止；旧元素延迟到达的 error 不影响新预览
    if (running && v === video) {
      previewFailed.value = true
      stopNow()
    }
  })
  // 真正有帧渲染才显示视频：playing 只代表"开始播放"，首帧可能尚未渲染，
  // 此时显示会黑屏。用 requestVideoFrameCallback 等到浏览器实际画出首帧。
  let firstFrameShown = false
  v.addEventListener('playing', () => {
    if (!(running && v === video) || firstFrameShown) return
    const show = () => {
      firstFrameShown = true
      if (!(running && v === video)) return
      setPreviewRatioFromVideo(v)
      v.style.opacity = '1'
      setPlaceholderLoading(false) // 视频就绪，隐藏「加载中」占位
    }
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(show)
    } else {
      // 不支持 rVFC（老浏览器）：playing 后延后一帧再显示
      requestAnimationFrame(show)
    }
  })
  // 视频尺寸就绪（videoWidth/videoHeight 可用）时刷新宽高比：
  // loadedmetadata 阶段尺寸可能还是 0，resize 事件保证拿到真实比例（竖屏/超宽屏自适应）
  v.addEventListener('resize', () => {
    if (running && v === video) setPreviewRatioFromVideo(v)
  })
  v.addEventListener('loadeddata', () => {
    if (running && v === video) setPreviewRatioFromVideo(v)
  })
  return v
}
// 预览区「加载中」占位开关（由 PathTip 消费：加载中显示 spinner，就绪后隐藏）
const placeholderLoading = ref(true)
// 视频宽高比（videoWidth/videoHeight，如横屏 1.78、竖屏 0.56）；null=未知（占位保持 16:9）
const previewRatio = ref<number | null>(null)
// 预览是否确认失败（error / seek 超时 / 时长无效）：PathTip 据此决定浮层无需等待比例即可显示
const previewFailed = ref(false)

function setPlaceholderLoading(v: boolean) {
  placeholderLoading.value = v
}

function setPreviewRatioFromVideo(v: HTMLVideoElement) {
  const w = v.videoWidth
  const h = v.videoHeight
  if (w > 0 && h > 0 && previewRatio.value !== w / h) previewRatio.value = w / h
}

function stopNow() {
  running = false
  setPlaceholderLoading(true)
  previewRatio.value = null // 重置为默认 16:9，供下一轮预览重新计算
  if (pendingStart) {
    clearTimeout(pendingStart)
    pendingStart = null
  }
  if (pendingStop) {
    clearTimeout(pendingStop)
    pendingStop = null
  }
  if (seekTimer) {
    clearTimeout(seekTimer)
    seekTimer = null
  }
  if (segTimer) {
    clearTimeout(segTimer)
    segTimer = null
  }
  if (video) {
    const el = video
    video = null
    el.pause()
    el.style.opacity = '0' // 先淡出（CSS 500ms 过渡）再移除，避免瞬间消失突兀
    el.removeAttribute('src')
    el.load()
    // 等淡出过渡完成后移除元素（元素独立，不复用，不影响新预览）
    window.setTimeout(() => el.remove(), 550)
  }
  activeId = ''
}

/** 浮层渲染完成后，其预览区才存在于 DOM */
function findPreviewContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.path-tip .path-tip-preview')
}

function runMontage(v: HTMLVideoElement, duration: number, positions: number[], segSec: number) {
  // 段位按 15%~85% 均匀分布；首段不做位置对齐（缩略图截帧位置不可靠），
  // 过渡完全交给淡入淡出：缩略图 → 首段视频平滑渐变。
  const targets = positions.map((p, i) => {
    const jitter = i === 0 ? (Math.random() * 2 - 1) * JITTER : 0
    return Math.min(0.9, Math.max(0.08, p + jitter)) * duration
  })

  const playAt = (i: number) => {
    if (!running) return
    const pos = targets[i % targets.length]
    v.currentTime = pos
    if (seekTimer) clearTimeout(seekTimer)
    seekTimer = setTimeout(() => {
      previewFailed.value = true
      stopNow()
    }, SEEK_TIMEOUT)
    const onSeeked = () => {
      if (seekTimer) {
        clearTimeout(seekTimer)
        seekTimer = null
      }
      if (!running) return
      // 显示由 createVideo 的 playing + requestVideoFrameCallback 驱动
      // （首帧真正渲染才显示）；这里只负责播放，失败由 SEEK_TIMEOUT 兜底。
      void v.play().catch(() => {})
      if (segTimer) clearTimeout(segTimer)
      segTimer = setTimeout(() => playAt(i + 1), segSec * 1000)
    }
    v.addEventListener('seeked', onSeeked, { once: true })
  }

  playAt(0)
}

export function useHoverPreview() {
  const settings = useSettingsStore()

  function startPreview(videoItem: Video) {
    if (settings.settings?.html5_hover_preview === false) return
    if (activeId === videoItem.id && running) return
    previewFailed.value = false // 新一轮预览重置失败标记
    if (pendingStop) {
      clearTimeout(pendingStop)
      pendingStop = null
    }
    if (pendingStart) clearTimeout(pendingStart)
    pendingStart = setTimeout(() => {
      pendingStart = null
      stopNow()
      activeId = videoItem.id
      running = true

      // video 立即创建并加载（不依赖浮层容器）：metadata 就绪即得到真实比例，
      // PathTip 据此渲染预览区；容器出现后再 append 并开始播放（未挂载时 play 无画面）。
      // 每次新建独立元素，避免复用残留（缓冲/事件状态）导致的偶发黑屏。
      const v = createVideo()
      video = v
      setPlaceholderLoading(true) // 新一轮加载，恢复「加载中」占位
      v.style.opacity = '0'
      v.src = streamUrl(videoItem.id)
      v.load()

      let started = false // 蒙太奇是否已启动（防止 attach/onMeta 重复触发）

      // 挂载 + metadata 均就绪后启动播放
      const startMontageIfReady = () => {
        if (!running || started) return
        if (!v.parentElement) return // 未挂载，等 attach
        const dur = v.duration
        if (!Number.isFinite(dur) || dur <= 0) return // metadata 未就绪，等 loadedmetadata
        started = true
        setPreviewRatioFromVideo(v)
        const segCount = Number(settings.settings?.html5_hover_preview_segments)
        const segSec = Number(settings.settings?.html5_hover_preview_segment_sec)
        const positions = computePositions(Number.isFinite(segCount) && segCount > 0 ? segCount : 5)
        const secPerSeg = Number.isFinite(segSec) && segSec > 0 ? segSec : 5
        runMontage(v, dur, positions, secPerSeg)
      }

      // 浮层渲染完成后把 video 挂到预览区
      const attach = (tries = 0) => {
        if (!running) return
        const container = findPreviewContainer()
        if (!container) {
          // 浮层在比例就绪后才渲染（PathTip 的 tipVisible 条件），稍等再挂载
          if (tries < MOUNT_RETRIES) {
            setTimeout(() => attach(tries + 1), MOUNT_RETRY_MS)
          }
          return
        }
        if (v.parentElement !== container) container.appendChild(v)
        startMontageIfReady()
      }

      // metadata 就绪（比例可知）即触发浮层渲染；一律等事件，避免复用元素时
      // 同步 readyState 拿到上次加载的残留状态导致误判失败
      const onMeta = () => {
        if (!running) return
        const dur = v.duration
        if (!Number.isFinite(dur) || dur <= 0) {
          previewFailed.value = true
          stopNow()
          return
        }
        setPreviewRatioFromVideo(v)
        startMontageIfReady()
      }
      v.addEventListener('loadedmetadata', onMeta, { once: true })

      attach()
    }, START_DELAY)
  }

  function stopPreview() {
    if (pendingStart) {
      clearTimeout(pendingStart)
      pendingStart = null
    }
    if (pendingStop) clearTimeout(pendingStop)
    pendingStop = setTimeout(() => stopNow(), STOP_DELAY)
  }

  /** 立即停止预览（关闭按钮等需要即刻生效的场景）。 */
  function stopPreviewNow() {
    if (pendingStart) {
      clearTimeout(pendingStart)
      pendingStart = null
    }
    if (pendingStop) {
      clearTimeout(pendingStop)
      pendingStop = null
    }
    stopNow()
  }

  return {
    startPreview,
    stopPreview,
    stopPreviewNow,
    placeholderLoading,
    previewRatio,
    previewFailed,
  }
}
