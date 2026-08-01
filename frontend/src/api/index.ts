export * from './client'
export * from './play'
export * from './albums'
export * from './thumbs'
export * from './files'

import { api } from './client'
import type { CategoriesResponse, LibrariesResponse, Settings, VideosResponse } from '@/types'

export const getLibraries = () => api<LibrariesResponse>('/libraries', { libraryId: null })

export const activateLibrary = (id: string) =>
  api<{ ok: boolean; active_library_id: string }>(`/libraries/${id}/activate`, {
    method: 'POST',
    libraryId: null,
  })

export const getCategories = () => api<CategoriesResponse>('/categories')

export const getVideos = (params: Record<string, string | number | boolean | undefined | null>) =>
  api<VideosResponse>('/videos', { params })

export const getSettings = (scope = 'merged') =>
  api<Settings>('/settings', { params: { scope } })

export const saveSettings = (data: Partial<Settings>, scope: 'global' | 'library' = 'global') =>
  api<Settings>('/settings', {
    method: 'POST',
    body: JSON.stringify({ ...data, scope }),
  })

export const getHealth = () => api<{ ok: boolean; boot_id: string }>('/health', { libraryId: null })

export const rescan = () => api<{ version: number; count: number }>('/rescan', { method: 'POST' })

export const toggleFavorite = (id: string) =>
  api<{ ok: boolean; id: string; favorited: boolean }>('/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
