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
const MOUNT_RETRIES = 12 // 等浮层渲染的最大重试次数（×40ms ≈ 480ms）
const MOUNT_RETRY_MS = 40

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
// 预览区「加载中」占位开关（由 PathTip 消费：加载中显示 spinner，就绪后隐藏）
const placeholderLoading = ref(true)
// 视频宽高比（videoWidth/videoHeight，如横屏 1.78、竖屏 0.56）；null=未知（占位保持 16:9）
const previewRatio = ref<number | null>(null)

function setPlaceholderLoading(v: boolean) {
  placeholderLoading.value = v
}

function setPreviewRatioFromVideo(v: HTMLVideoElement) {
  const w = v.videoWidth
  const h = v.videoHeight
  if (w > 0 && h > 0) previewRatio.value = w / h
}

function getVideo(): HTMLVideoElement {
  if (!video) {
    video = document.createElement('video')
    video.className = 'hover-preview-video'
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    // 初始透明：加载/seek 阶段盖在 <img> 上不闪黑，play() 成功后才显示
    video.style.opacity = '0'
    video.addEventListener('error', () => {
      // 仅预览运行中的错误才静默终止（清空 src 时的正常 abort 不算）
      if (running) stopNow()
    })
  }
  return video
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
    el.pause()
    el.style.opacity = '0' // 先淡出（CSS 500ms 过渡）再移除，避免瞬间消失突兀
    el.removeAttribute('src')
    el.load()
    // 等淡出过渡完成后才从 DOM 移除；若期间已开启新预览（复用同一元素）则跳过
    const container = el.parentElement
    window.setTimeout(() => {
      if (!running && el.parentElement === container) el.remove()
    }, 550)
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
    seekTimer = setTimeout(() => stopNow(), SEEK_TIMEOUT)
    const onSeeked = () => {
      if (seekTimer) {
        clearTimeout(seekTimer)
        seekTimer = null
      }
      if (!running) return
      // play() 成功后画面已就绪，再显示 video（避免加载/seek 阶段黑屏闪烁）
      void v
        .play()
        .then(() => {
          if (running) {
            v.style.opacity = '1'
            setPlaceholderLoading(false) // 视频就绪，隐藏「加载中」占位
          }
        })
        .catch(() => {})
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

      const tryMount = (tries = 0) => {
        if (!running) return
        const container = findPreviewContainer()
        if (!container) {
          // 浮层（PathTip）有自己的 220ms 显示延迟 + nextTick 渲染，稍等再挂载
          if (tries < MOUNT_RETRIES) {
            setTimeout(() => tryMount(tries + 1), MOUNT_RETRY_MS)
          } else {
            stopNow()
          }
          return
        }
        const v = getVideo()
        setPlaceholderLoading(true) // 新一轮加载，恢复「加载中」占位
        v.style.opacity = '0' // 复用元素时重置，避免上次淡出未完成直接显示
        container.appendChild(v)
        v.src = streamUrl(videoItem.id)
        v.load()
        const onMeta = () => {
          if (!running) return
          const dur = v.duration
          if (!Number.isFinite(dur) || dur <= 0) {
            stopNow()
            return
          }
          // 拿到真实宽高比，浮层占位据此自适应（竖屏视频不再被压成横屏）
          setPreviewRatioFromVideo(v)
          // 段数/每段秒数从设置读取（后端重启前可能缺失，用默认值兜底）
          const segCount = Number(settings.settings?.html5_hover_preview_segments)
          const segSec = Number(settings.settings?.html5_hover_preview_segment_sec)
          const positions = computePositions(Number.isFinite(segCount) && segCount > 0 ? segCount : 5)
          const secPerSeg = Number.isFinite(segSec) && segSec > 0 ? segSec : 5
          runMontage(v, dur, positions, secPerSeg)
        }
        if (v.readyState >= 1) onMeta()
        else v.addEventListener('loadedmetadata', onMeta, { once: true })
      }
      tryMount()
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

  return { startPreview, stopPreview, stopPreviewNow, placeholderLoading, previewRatio }
}
