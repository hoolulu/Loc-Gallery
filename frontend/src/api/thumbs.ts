import { api } from './client'



export interface ThumbCandidate {

  index: number

  pos: number

  score?: number

}



export const getThumbStatus = (params?: { category?: string; page_ids?: string }) =>

  api<Record<string, unknown>>('/thumb/status', { params })



export const pauseThumbs = () => api('/thumb/pause', { method: 'POST' })



export const resumeThumbs = () => api('/thumb/resume', { method: 'POST' })



export const regenerateThumb = (ids?: string[]) =>

  api('/thumb/regenerate', {

    method: 'POST',

    body: JSON.stringify(ids ? { ids } : {}),

  })



export const batchRegenerateThumb = (ids: string[], autoSelect = true) =>
  api('/thumb/batch-regenerate', {
    method: 'POST',
    body: JSON.stringify({ ids, auto_select: autoSelect }),
  })



export const getThumbFailed = () =>

  api<{ items: { id: string; title: string; error: string }[]; total: number }>('/thumb/failed')



export const regenerateFailed = () => api('/thumb/regenerate-failed', { method: 'POST' })



export const priorityThumbs = (ids: string[]) =>

  api('/thumb/priority', { method: 'POST', body: JSON.stringify({ ids }) })



export const getDurationStatus = () => api<Record<string, unknown>>('/duration/status')



export const getFormatStatus = () => api<Record<string, unknown>>('/format/status')



export const scanFormat = () => api('/format/scan', { method: 'POST' })



export const generateThumbCandidates = (videoId: string, jitter = false) =>

  api<{ ok: boolean; version: string; candidates: ThumbCandidate[] }>(

    `/thumb/${videoId}/candidates`,

    { method: 'POST', params: jitter ? { jitter: 'true' } : {} },

  )



export const pickThumbCandidate = (videoId: string, index: number) =>

  api<{ ok: boolean; version: string }>(`/thumb/${videoId}/pick`, {

    method: 'POST',

    body: JSON.stringify({ index }),

  })

