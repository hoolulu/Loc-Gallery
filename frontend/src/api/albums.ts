import { api } from './client'
import type { Album } from '@/types'

export const getAlbums = () => api<{ items: Album[] }>('/albums')

export const getAlbum = (id: string) =>
  api<Album & { total_duration_sec?: number }>(`/albums/${id}`)

export const createAlbum = (name: string, description = '') =>
  api<{ ok: boolean; album: Album }>('/albums', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })

export const updateAlbum = (id: string, data: Partial<Album>) =>
  api<{ ok: boolean; album: Album }>(`/albums/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const deleteAlbum = (id: string) =>
  api<{ ok: boolean }>(`/albums/${id}`, { method: 'DELETE' })

export const addVideosToAlbum = (albumId: string, ids: string[]) =>
  api(`/albums/${albumId}/videos`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })

export const removeVideosFromAlbum = (albumId: string, ids: string[]) =>
  api(`/albums/${albumId}/videos/remove`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })

export const setAlbumCover = (albumId: string, videoId: string) =>
  api(`/albums/${albumId}/cover`, {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId }),
  })
