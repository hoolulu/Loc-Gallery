import { api } from './client'
import type { FolderTreeResponse } from '@/types'

export const deleteVideos = (ids: string[]) =>
  api<{ deleted: string[]; errors?: string[] }>('/videos/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })

export const renameVideo = (id: string, newName: string) =>
  api('/videos/rename', {
    method: 'POST',
    body: JSON.stringify({ id, new_name: newName }),
  })

export const moveVideos = (ids: string[], category: string) =>
  api('/videos/move', {
    method: 'POST',
    body: JSON.stringify({ ids, category }),
  })

export const openFolder = (id: string) =>
  api<{ ok: boolean; folder: string }>(`/open-folder/${id}`, { method: 'POST' })

export const clearHistory = () => api('/history/clear', { method: 'POST' })

export const restartService = () =>
  api<{ ok: boolean; boot_id: string }>('/service/restart', { method: 'POST', libraryId: null })

export const pickFolder = () =>
  api<{ ok: boolean; cancelled?: boolean; path?: string }>('/libraries/pick-folder', {
    method: 'POST',
    libraryId: null,
  })

export const createLibrary = (alias: string, path: string) =>
  api('/libraries', {
    method: 'POST',
    body: JSON.stringify({ alias, path }),
    libraryId: null,
  })

export const updateLibrary = (id: string, data: { alias?: string; path?: string }) =>
  api(`/libraries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    libraryId: null,
  })

export const deleteLibrary = (id: string, deleteData = false) =>
  api(`/libraries/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ delete_data: deleteData }),
    libraryId: null,
  })

export const getFolders = (category: string) =>
  api<FolderTreeResponse>('/folders', { params: { category } })

export const deleteFolder = (category: string, folder: string, type: 'subdir' | 'cat' = 'subdir') =>
  api('/folders/delete', {
    method: 'POST',
    body: JSON.stringify({ category, folder, type }),
  })

export const renameFolder = (
  category: string,
  oldPath: string,
  newName: string,
  type: 'subdir' | 'cat' = 'subdir',
) =>
  api('/folders/rename', {
    method: 'POST',
    params: { category, old_path: oldPath, new_name: newName, type },
  })

export const moveFolder = (
  category: string,
  srcPath: string,
  destPath: string,
  type: 'subdir' | 'cat' = 'subdir',
) =>
  api('/folders/move', {
    method: 'POST',
    params: { category, src_path: srcPath, dest_path: destPath, type },
  })

export const reorderCategories = (order: string[]) =>
  api('/categories/reorder', { method: 'POST', body: JSON.stringify({ order }) })

export const setCategorySortMode = (sort_mode: string) =>
  api('/categories/sort-mode', { method: 'POST', body: JSON.stringify({ sort_mode }) })

export const batchFavorites = (ids: string[], action: 'add' | 'remove') =>
  api('/favorites/batch', {
    method: 'POST',
    body: JSON.stringify({ ids, action }),
  })

export const beginBatchRemux = () => api('/remux/batch/begin', { method: 'POST' })

export const endBatchRemux = () => api('/remux/batch/end', { method: 'POST' })
