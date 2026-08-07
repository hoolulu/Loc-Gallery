import { useLibraryStore } from '@/stores/library'

import { usePlayerStore } from '@/stores/player'

import { useSettingsStore } from '@/stores/settings'

import { useUiStore } from '@/stores/ui'

import { streamUrl } from '@/api/client'

import {

  getPlayInfo,

  getRemuxStatus,

  playExternal,

  recordPlay,

  savePosition,

  startRemux,

} from '@/api/play'

import { formatDuration, getSavedPosition } from '@/utils/format'
import { createMoviPlayer } from './useMoviPlayer'
import { usePlaylistLoader } from './usePlaylistLoader'
import { usePlayerUrlSync } from './usePlayerUrlSync'
import { resetPlayerRestore } from './usePlayerRestore'

import type { PlayInfo, SortMode, Video } from '@/types'



export function usePlayback() {

  const player = usePlayerStore()

  const library = useLibraryStore()

  const settings = useSettingsStore()

  const ui = useUiStore()
  const { ensureAdjacent, reloadForSort, prefetchIfNeeded } = usePlaylistLoader()
  const { setPlayInUrl } = usePlayerUrlSync()

  let saveTimer: ReturnType<typeof setTimeout> | null = null



  function videoEl() {

    return player.videoEl

  }



  function destroyMovi() {
    try {
      player.moviPlayer?.destroy()
    } catch {
      /* ignore */
    }
    player.moviPlayer = null
  }

  async function stopSlice() {
    destroyMovi()

    player.activeSliceVideoId = null

    const video = videoEl()

    if (video) {

      video.removeAttribute('src')

      video.load()

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

    // 修复后的文件已可被 mp4box 正常解析；传 remuxable:false 防止 watchdog 再次触发重封装
    await startMovi(id, item, session, { remuxable: false })

  }



  async function startMovi(id: string, item: Video, session: number, extra: { remuxable?: boolean } = {}) {
    destroyMovi()

    const host = player.moviHostEl
    if (!host) return

    const url = streamUrl(id, library.activeLibraryId)
    let readyFired = false
    let watchdog: ReturnType<typeof setTimeout> | null = null
    player.showOverlay('加载视频', '正在分析…', { indeterminate: true })

    const resume = settings.settings?.html5_resume_playback !== false
    const resumeAt = getSavedPosition(item.playPosition, item.playDuration, resume) || 0

    const mp = createMoviPlayer(
      host,
      url,
      {
        onReady: () => {
          readyFired = true
          if (watchdog) clearTimeout(watchdog)
          if (player.isStale(session)) return
          player.moviPlayer = mp
          player.currentTime = 0
          player.duration = mp.getDuration()
          player.isPaused = false
          player.volume = 1
          player.muted = false
          player.hideOverlay()
          // 当前为 ready 但还没播放时显式播放；已 playing 则跳过（避免重复 play 报错）
          if (mp.getPaused()) void mp.play()
          if (resumeAt > 0) {
            player.statusText = `从 ${formatDuration(resumeAt)} 继续播放`
            // 续播提示 3 秒后自动消失
            setTimeout(() => {
              if (player.statusText.startsWith('从 ')) player.statusText = ''
            }, 3000)
          }
          void recordPlay(id)
          updateMediaSession(item)
          prefetchIfNeeded()
        },
        onTime: (t) => {
          player.currentTime = t
          player.duration = mp.getDuration() || player.duration
          if (!resume) return
          if (saveTimer) clearTimeout(saveTimer)
          saveTimer = setTimeout(() => {
            void savePosition(id, t, mp.getDuration() || undefined)
          }, 2500)
        },
        onEnded: () => {
          void savePosition(id, mp.getDuration() || mp.getCurrentTime(), mp.getDuration() || undefined)
          void (async () => {
            await stopSlice()
            if (settings.settings?.html5_playlist_autoplay !== false && player.open) {
              await playAdjacent(1)
            }
          })()
        },
        onStateChange: (state) => {
          player.isPaused = state !== 'playing'
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : '未知播放错误'
          player.hideOverlay()
          player.statusText = `播放失败：${msg}`
          setTimeout(() => {
            if (player.statusText.startsWith('播放失败')) player.statusText = ''
          }, 15000)
        },
      },
      { startAt: resumeAt, seekPreview: settings.settings?.html5_seek_preview !== false },
    )

    // 元素创建即触发加载，无需 await load()；就绪回调在 statechange(ready/playing) 中处理后续。
    if (player.isStale(session)) {
      mp.destroy()
      player.moviPlayer = null
    } else {
      // 保底诊断：若 12 秒内未进入就绪状态，说明播放器未初始化
      // （多为自定义元素未注册、WASM 解码器或视频流加载失败）。
      watchdog = setTimeout(async () => {
        if (readyFired || player.isStale(session)) return
        // 挂起未就绪：多为 movi-player 的 mp4box demuxer 无法解析该文件 moov
        // （多段 mdat / sdtp 等，media_probe 已标记 remuxable）。自动走重封装修复，
        // 避免永久卡"加载中"。修复后文件原地替换，mtime/size 变化会失效 plan 缓存。
        if (extra.remuxable) {
          destroyMovi()
          player.moviPlayer = null
          await runVideoRemux(id, item, session)
          return
        }
        player.showOverlay(
          '播放器无响应',
          '12 秒内未进入就绪状态。请按 F12 打开控制台，查看是否有 [LocGallery] 或 movi-player 的红色报错（常见于 .wasm 解码器 / 视频流加载失败），截图发我即可定位。',
          { indeterminate: false },
        )
      }, 12000)
    }
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

    } else if (choice === 'external') {

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
    setPlayInUrl(item.id)



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
        // 多段 mdat / 碎片化 MP4（media_probe 标记 remuxable）不能被 movi-player
        // 的 mp4box 直接解析（会永久卡 loading），先重封装修复再播；普通大文件
        // 的 hls 方案（remuxable=false）仍直连播放。
        if (info.remuxable) {
          await runVideoRemux(item.id, item, session)
        } else {
          await startMovi(item.id, item, session, { remuxable: false })
        }
        return
      }



      try {

        await startMovi(item.id, item, session, { remuxable: !!info.remuxable })

      } catch (err) {

        if (info.experimental_direct) {

          await startMovi(item.id, item, session, { remuxable: !!info.remuxable })

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

      if (choice === 'external') await playExternal(item.id)

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
    setPlayInUrl(null)
    resetPlayerRestore()

  }



  async function playAdjacent(delta: number) {
    const next = await ensureAdjacent(delta)
    if (next) await playVideo(next, player.playlist)
  }

  async function reloadPlaylist(sort: SortMode) {
    await reloadForSort(sort)
  }



  function wheelSeek(deltaY: number) {

    const mp = player.moviPlayer

    if (!mp || !player.open) return

    const step = settings.settings?.html5_wheel_seek_sec ?? 5

    const dir = deltaY > 0 ? 1 : -1

    const next = Math.max(0, Math.min(mp.getDuration() || 0, mp.getCurrentTime() + dir * step))

    mp.seek(next)

  }



  async function onPageHide() {

    const mp = player.moviPlayer

    const id = player.playingId

    if (mp && id && mp.getCurrentTime() > 1) {

      try {

        await savePosition(id, mp.getCurrentTime(), mp.getDuration() || undefined)

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

