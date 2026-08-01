import Hls from 'hls.js'
import { usePlayerStore } from '@/stores/player'
import { catchupSlice, getPlayStatus, pauseSlice, resumeSlice } from '@/api/play'

const SLICE_AHEAD_MIN_SEC = 10
const SLICE_AHEAD_MAX_SEC = 30
const SLICE_EDGE_RESERVE_SEC = 4

type ThrottleCtx = {
  videoId: string
  session: number
  video: HTMLVideoElement
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
  onTick: () => void
  onSeeked: () => void
  onStall: () => void
}

let throttle: ThrottleCtx | null = null
let catchupTimer: ReturnType<typeof setTimeout> | null = null

function mediaBufferedAheadSec(video: HTMLVideoElement): number {
  const t = video.currentTime
  const buf = video.buffered
  if (!buf?.length) return 0
  for (let i = 0; i < buf.length; i++) {
    if (buf.start(i) <= t && t <= buf.end(i)) return Math.max(0, buf.end(i) - t)
  }
  return Math.max(0, buf.end(buf.length - 1) - t)
}

export function clearHlsSliceThrottle() {
  if (catchupTimer) {
    clearTimeout(catchupTimer)
    catchupTimer = null
  }
  if (!throttle) return
  clearInterval(throttle.timer)
  throttle.video.removeEventListener('timeupdate', throttle.onTick)
  throttle.video.removeEventListener('seeking', throttle.onTick)
  throttle.video.removeEventListener('seeked', throttle.onSeeked)
  throttle.video.removeEventListener('waiting', throttle.onStall)
  throttle = null
}

async function postCatchup(videoId: string, positionSec: number, hls: Hls | null) {
  await catchupSlice(videoId, positionSec)
  try {
    hls?.startLoad(-1)
  } catch {
    /* ignore */
  }
}

async function tickThrottle(opts: { afterSeek?: boolean; forceResume?: boolean } = {}) {
  const ctx = throttle
  if (!ctx || ctx.inFlight) return
  const player = usePlayerStore()
  if (player.isStale(ctx.session) || player.activeSliceVideoId !== ctx.videoId) {
    clearHlsSliceThrottle()
    return
  }
  ctx.inFlight = true
  try {
    const st = await getPlayStatus(ctx.videoId)
    const segSec = st.segment_seconds || 6
    if (!st.processing || st.cached) {
      clearHlsSliceThrottle()
      return
    }
    const t = Number.isFinite(ctx.video.currentTime) ? ctx.video.currentTime : 0
    const producedEnd = st.produced_end_sec ?? (st.segments || 0) * segSec
    const producedAhead = Math.max(0, producedEnd - t)
    const paused = !!st.slice_paused
    const nearEdge = producedAhead <= SLICE_EDGE_RESERVE_SEC
    const runningLow = producedAhead <= SLICE_AHEAD_MIN_SEC

    if (opts.afterSeek || opts.forceResume || nearEdge) {
      if (opts.afterSeek || opts.forceResume) {
        await postCatchup(ctx.videoId, t, player.hlsInstance as Hls | null)
      } else {
        clearTimeout(catchupTimer!)
        catchupTimer = setTimeout(() => postCatchup(ctx.videoId, t, player.hlsInstance as Hls | null), 180)
      }
    }

    if (!paused && producedAhead >= SLICE_AHEAD_MAX_SEC) {
      await pauseSlice()
    } else if (paused && (runningLow || nearEdge || opts.afterSeek || opts.forceResume)) {
      await resumeSlice()
    }
  } catch {
    /* ignore */
  } finally {
    ctx.inFlight = false
  }
}

export function bindHlsSliceThrottle(video: HTMLVideoElement, videoId: string, session: number) {
  clearHlsSliceThrottle()
  const onTick = () => {
    void tickThrottle()
  }
  const onSeeked = () => {
    void tickThrottle({ afterSeek: true })
  }
  const onStall = () => {
    void tickThrottle({ forceResume: true })
  }
  throttle = {
    videoId,
    session,
    video,
    inFlight: false,
    onTick,
    onSeeked,
    onStall,
    timer: setInterval(onTick, 1200),
  }
  video.addEventListener('timeupdate', onTick)
  video.addEventListener('seeking', onTick)
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('waiting', onStall)
  onTick()
}

export function bufferedAhead(video: HTMLVideoElement) {
  return mediaBufferedAheadSec(video)
}
