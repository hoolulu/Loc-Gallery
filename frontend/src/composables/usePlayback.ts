import Hls from 'hls.js'

import { useLibraryStore } from '@/stores/library'

import { usePlayerStore } from '@/stores/player'

import { useSettingsStore } from '@/stores/settings'

import { useUiStore } from '@/stores/ui'

import { streamUrl } from '@/api/client'

import {

  getPlayInfo,

  getPlayStatus,

  getRemuxStatus,

  hlsPlaylistUrl,

  playExternal,

  preparePlay,

  recordPlay,

  savePosition,

  startRemux,

  stopPlay,

} from '@/api/play'

import { formatDuration, getSavedPosition } from '@/utils/format'

import { bindHlsSliceThrottle, clearHlsSliceThrottle } from './useHlsThrottle'
import { usePlaylistLoader } from './usePlaylistLoader'

import type { PlayInfo, SortMode, Video } from '@/types'



export function usePlayback() {

  const player = usePlayerStore()

  const library = useLibraryStore()

  const settings = useSettingsStore()

  const ui = useUiStore()
  const { ensureAdjacent, reloadForSort, prefetchIfNeeded } = usePlaylistLoader()

  let saveTimer: ReturnType<typeof setTimeout> | null = null



  function videoEl() {

    return player.videoEl

  }



  function destroyHls() {

    const hls = player.hlsInstance

    if (hls) {

      try {

        hls.stopLoad()

        hls.detachMedia()

        hls.destroy()

      } catch {

        /* ignore */

      }

      player.hlsInstance = null

    }

  }



  async function stopSlice() {

    clearHlsSliceThrottle()

    destroyHls()

    player.activeSliceVideoId = null

    const video = videoEl()

    if (video) {

      video.removeAttribute('src')

      video.load()

    }

    try {

      await stopPlay()

    } catch {

      /* ignore */

    }

  }



  function unbindSaver() {

    if (saveTimer) clearTimeout(saveTimer)

    saveTimer = null

    const video = videoEl()

    if (!video?._handlers) return

    const { onTimeupdate, onPause, onEnded } = video._handlers

    video.removeEventListener('timeupdate', onTimeupdate)

    video.removeEventListener('pause', onPause)

    video.removeEventListener('ended', onEnded)

    delete video._handlers

  }



  function bindSaver(video: HTMLVideoElement, id: string) {

    unbindSaver()

    const resume = settings.settings?.html5_resume_playback !== false

    const onTimeupdate = () => {

      if (!resume) return

      if (saveTimer) clearTimeout(saveTimer)

      saveTimer = setTimeout(() => {

        void savePosition(id, video.currentTime, video.duration || undefined)

      }, 2500)

    }

    const onPause = () => {

      if (!resume || video.currentTime < 1) return

      void savePosition(id, video.currentTime, video.duration || undefined)

    }

    const onEnded = () => {

      void savePosition(id, video.duration || video.currentTime, video.duration || undefined)

      void (async () => {

        await stopSlice()

        if (settings.settings?.html5_playlist_autoplay !== false && player.open) {

          await playAdjacent(1)

        }

      })()

    }

    video.addEventListener('timeupdate', onTimeupdate)

    video.addEventListener('pause', onPause)

    video.addEventListener('ended', onEnded)

    video._handlers = { onTimeupdate, onPause, onEnded }

  }



  async function seekResume(video: HTMLVideoElement, item: Video) {

    const resume = settings.settings?.html5_resume_playback !== false

    const target = getSavedPosition(item.playPosition, item.playDuration, resume)

    if (!target) return null

    try {

      video.currentTime = target

    } catch {

      return null

    }

    player.statusText = `从 ${formatDuration(target)} 继续播放`

    return target

  }



  async function waitCanPlay(video: HTMLVideoElement, session: number, timeoutMs = 120000) {

    if (player.isStale(session)) throw new Error('已切换视频')

    return new Promise<void>((resolve, reject) => {

      const cleanup = () => {

        clearTimeout(timer)

        video.removeEventListener('canplay', onReady)

        video.removeEventListener('error', onError)

      }

      const onReady = () => {

        cleanup()

        resolve()

      }

      const onError = () => {

        cleanup()

        reject(new Error('视频加载失败'))

      }

      if (video.readyState >= 3) {

        resolve()

        return

      }

      const timer = setTimeout(() => {

        cleanup()

        reject(new Error('视频缓冲超时'))

      }, timeoutMs)

      video.addEventListener('canplay', onReady)

      video.addEventListener('error', onError, { once: true })

    })

  }



  async function waitHlsReady(id: string, session: number, transcode = false) {

    const limit = (transcode ? 300 : 180) * 1000

    const start = Date.now()

    while (Date.now() - start < limit) {

      if (player.isStale(session)) throw new Error('已切换视频')

      const st = await getPlayStatus(id)

      if (st.ready) return st

      if (st.state === 'error') throw new Error(st.error || 'HLS 准备失败')

      player.showOverlay(

        transcode ? '正在转码' : '正在切片',

        `已等待 ${Math.round((Date.now() - start) / 1000)}s`,

        { indeterminate: !st.segments, progress: st.segments ? 50 : null },

      )

      await new Promise((r) => setTimeout(r, 600))

    }

    throw new Error('准备超时')

  }



  async function waitRemuxDone(id: string, session: number) {

    const start = Date.now()

    while (Date.now() - start < 600000) {

      if (player.isStale(session)) throw new Error('已切换视频')

      const st = await getRemuxStatus(id)

      if (st.state === 'done') return

      if (st.state === 'error') throw new Error(st.error || '修复失败')

      player.showOverlay('正在修复', st.message || '流复制重封装中…', {

        indeterminate: st.progress_pct == null,

        progress: st.progress_pct ?? null,

      })

      await new Promise((r) => setTimeout(r, 800))

    }

    throw new Error('修复超时')

  }



  async function runVideoRemux(id: string, item: Video, session: number) {

    await stopSlice()

    player.showOverlay('正在修复', '启动重封装…', { indeterminate: true })

    await startRemux(id)

    if (player.isStale(session)) return

    await waitRemuxDone(id, session)

    if (player.isStale(session)) return

    await startDirect(id, item, session)

  }



  async function startDirect(id: string, item: Video, session: number) {

    destroyHls()

    const video = videoEl()

    if (!video) return

    video.src = streamUrl(id, library.activeLibraryId)

    player.showOverlay('加载视频', '正在缓冲…', { indeterminate: true })

    await waitCanPlay(video, session)

    if (player.isStale(session)) return

    await seekResume(video, item)

    await video.play().catch(() => {})

    player.hideOverlay()

    bindSaver(video, id)

    void recordPlay(id)

    updateMediaSession(item)
    prefetchIfNeeded()
  }

  async function startHls(id: string, item: Video, session: number, transcode = false) {

    destroyHls()

    const video = videoEl()

    if (!video) return

    const url = hlsPlaylistUrl(id, library.activeLibraryId)

    const resumeAt = getSavedPosition(item.playPosition, item.playDuration) || 0

    player.showOverlay(transcode ? '转码播放' : 'HLS 播放', '连接切片流…', { indeterminate: true })



    if (Hls.isSupported()) {

      await new Promise<void>((resolve, reject) => {

        const timer = setTimeout(() => reject(new Error('HLS 清单加载超时')), 45000)

        const hls = new Hls({ enableWorker: true, startPosition: resumeAt })

        player.hlsInstance = hls

        hls.loadSource(url)

        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {

          clearTimeout(timer)

          resolve()

        })

        hls.on(Hls.Events.ERROR, (_, data) => {

          if (data?.fatal) {

            clearTimeout(timer)

            reject(new Error('HLS 播放失败'))

          }

        })

      })

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {

      video.src = url

    } else {

      throw new Error('浏览器不支持 HLS')

    }



    await waitCanPlay(video, session, transcode ? 180000 : 120000)

    if (player.isStale(session)) return

    await seekResume(video, item)

    await video.play().catch(() => {})

    player.hideOverlay()

    bindSaver(video, id)

    bindHlsSliceThrottle(video, id, session)

    void recordPlay(id)

    updateMediaSession(item)
    prefetchIfNeeded()
  }

  async function startWebHls(id: string, item: Video, session: number, info: PlayInfo) {

    const transcode = info.mode === 'hls' && !!info.transcode

    player.activeSliceVideoId = id

    player.showOverlay('准备播放', '启动切片任务…', { indeterminate: true })

    const prep = await preparePlay(id)

    if (player.isStale(session)) return

    if (!prep.ready && !prep.cached) {

      await waitHlsReady(id, session, transcode)

    }

    if (player.isStale(session)) return

    await startHls(id, item, session, transcode)

  }



  function updateMediaSession(item: Video) {

    if (!navigator.mediaSession) return

    try {

      navigator.mediaSession.metadata = new MediaMetadata({

        title: item.title || item.filename,

        artist: item.category,

      })

      navigator.mediaSession.setActionHandler('previoustrack', () => void playAdjacent(-1))

      navigator.mediaSession.setActionHandler('nexttrack', () => void playAdjacent(1))

    } catch {

      /* ignore */

    }

  }



  function clearMediaSession() {

    if (!navigator.mediaSession) return

    try {

      navigator.mediaSession.metadata = null

      navigator.mediaSession.setActionHandler('previoustrack', null)

      navigator.mediaSession.setActionHandler('nexttrack', null)

    } catch {

      /* ignore */

    }

  }



  async function handleExternalOrUnsupported(info: PlayInfo, item: Video, session: number) {

    const choice = await ui.showNonStandardDialog({

      reason: info.reason || '该视频需要修复或外部播放。',

      remuxable: !!info.remuxable,

    })

    if (player.isStale(session)) return

    if (choice === 'remux') {

      await runVideoRemux(item.id, item, session)

    } else if (choice === 'potplayer') {

      await playExternal(item.id)

      player.closePlayer()

    } else {

      player.closePlayer()

    }

  }



  async function playVideo(item: Video, playlist: Video[] = []) {

    const session = player.bumpSession()

    unbindSaver()

    await stopSlice()

    player.openPlayer(item, playlist.length ? playlist : player.playlist)



    try {

      player.showOverlay('检测兼容性', '分析视频格式…', { indeterminate: true })

      const info = await getPlayInfo(item.id)

      if (player.isStale(session)) return



      if (info.mode === 'unsupported') {

        player.hideOverlay()

        await handleExternalOrUnsupported(info, item, session)

        return

      }



      if (info.mode === 'external') {

        player.hideOverlay()

        await handleExternalOrUnsupported(info, item, session)

        return

      }



      if (info.mode === 'hls') {

        await startWebHls(item.id, item, session, info)

        return

      }



      try {

        await startDirect(item.id, item, session)

      } catch (err) {

        if (info.experimental_direct) {

          await startWebHls(item.id, item, session, { ...info, mode: 'hls', transcode: true })

        } else {

          throw err

        }

      }

    } catch (err) {

      if (player.isStale(session)) return

      player.hideOverlay()

      const msg = err instanceof Error ? err.message : String(err)

      const choice = await ui.showNonStandardDialog({

        reason: `播放失败: ${msg}`,

        remuxable: false,

      })

      if (choice === 'potplayer') await playExternal(item.id)

      player.closePlayer()

    }

  }



  async function cancelPlayback() {

    player.bumpSession()

    unbindSaver()

    clearMediaSession()

    await stopSlice()

    player.playlist = []
    player.resetPlaylistMeta()
    player.lastPlayedItem = null
    player.closePlayer()

  }



  async function playAdjacent(delta: number) {
    const next = await ensureAdjacent(delta)
    if (next) await playVideo(next, player.playlist)
  }

  async function reloadPlaylist(sort: SortMode) {
    await reloadForSort(sort)
  }



  function wheelSeek(deltaY: number) {

    const video = videoEl()

    if (!video || !player.open) return

    const step = settings.settings?.html5_wheel_seek_sec ?? 5

    const dir = deltaY > 0 ? 1 : -1

    const next = Math.max(0, Math.min(video.duration || 0, video.currentTime + dir * step))

    video.currentTime = next

  }



  async function onPageHide() {

    const video = videoEl()

    const id = player.playingId

    if (video && id && video.currentTime > 1) {

      try {

        await savePosition(id, video.currentTime, video.duration || undefined)

      } catch {

        /* ignore */

      }

    }

    await stopSlice()

  }



  return {

    playVideo,

    cancelPlayback,

    playAdjacent,

    stopSlice,

    unbindSaver,

    reloadPlaylist,

    wheelSeek,

    onPageHide,

  }

}



declare global {

  interface HTMLVideoElement {

    _handlers?: {

      onTimeupdate: () => void

      onPause: () => void

      onEnded: () => void

    }

  }

}

