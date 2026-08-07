import { api } from './client'
import type { PlayInfo, Video } from '@/types'

export const getPlayInfo = (id: string) => api<PlayInfo>(`/play/info/${id}`)

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

export type { Video }
