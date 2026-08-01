import { api } from './client'
import type { PlayInfo, Video } from '@/types'

export const getPlayInfo = (id: string) => api<PlayInfo>(`/play/info/${id}`)

export const preparePlay = (id: string) =>
  api<Record<string, unknown>>(`/play/prepare/${id}`, { method: 'POST' })

export const getPlayStatus = (id: string) =>
  api<{
    ready: boolean
    state: string
    segments?: number
    segment_seconds?: number
    processing?: boolean
    cached?: boolean
    slice_paused?: boolean
    produced_end_sec?: number
    elapsed_sec?: number
    error?: string
  }>(`/play/status/${id}`)

export const stopPlay = () => api<{ ok: boolean }>('/play/stop', { method: 'POST' })

export const pauseSlice = () => api<{ ok: boolean }>('/play/pause', { method: 'POST' })

export const resumeSlice = () => api<{ ok: boolean }>('/play/resume', { method: 'POST' })

export const catchupSlice = (id: string, positionSec: number) =>
  api(`/play/catchup/${id}`, {
    method: 'POST',
    body: JSON.stringify({ position_sec: positionSec }),
  })

export const playExternal = (id: string) =>
  api<{ ok: boolean; path: string }>(`/play-external/${id}`, { method: 'POST' })

export const startRemux = (id: string) =>
  api<Record<string, unknown>>(`/videos/${id}/remux`, { method: 'POST' })

export const getRemuxStatus = (id: string) =>
  api<{ state: string; progress_pct?: number; message?: string; error?: string }>(
    `/videos/${id}/remux`,
  )

export const recordPlay = (id: string) =>
  api('/history/record', { method: 'POST', body: JSON.stringify({ id }) })

export const savePosition = (id: string, positionSec: number, durationSec?: number) =>
  api('/history/position', {
    method: 'POST',
    body: JSON.stringify({ id, position_sec: positionSec, duration_sec: durationSec }),
  })

export function hlsPlaylistUrl(id: string, libraryId?: string | null): string {
  const params = new URLSearchParams()
  if (libraryId) params.set('library_id', libraryId)
  const qs = params.toString()
  return `/api/hls/${id}/playlist.m3u8${qs ? `?${qs}` : ''}`
}

export type { Video }
