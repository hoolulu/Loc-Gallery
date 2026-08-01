import { defineStore } from 'pinia'

import { computed, ref } from 'vue'

import type { ThumbCandidate } from '@/api/thumbs'



export type ContextMenuItem = {

  label: string

  action: string

  danger?: boolean

  disabled?: boolean

}



export const useUiStore = defineStore('ui', () => {

  const manageMode = ref(false)

  const selectedIds = ref<Set<string>>(new Set())

  const settingsOpen = ref(false)

  const toast = ref<{ message: string; type?: string } | null>(null)



  const nonStandardOpen = ref(false)

  const nonStandardReason = ref('')

  const nonStandardRemuxable = ref(false)

  let nonStandardResolver: ((choice: 'remux' | 'potplayer' | 'cancel') => void) | null = null



  const albumPickerOpen = ref(false)

  const albumPickerIds = ref<string[]>([])



  const thumbFailedOpen = ref(false)

  const thumbProgressExpanded = ref(false)

  const thumbPickerOpen = ref(false)
  const thumbPickerVideoId = ref<string | null>(null)
  const thumbPickerSubtitle = ref('')
  const thumbPickerCandidates = ref<ThumbCandidate[]>([])
  const thumbPickerVersion = ref('')
  let thumbPickerResolver: ((picked: boolean) => void) | null = null

  const folderMoveOpen = ref(false)
  const folderMovePayload = ref<{
    mode: 'folder' | 'videos'
    category?: string
    path?: string
    folderType?: 'subdir' | 'cat'
    videoIds?: string[]
  } | null>(null)



  const contextMenu = ref<{

    x: number

    y: number

    items: ContextMenuItem[]

    targetId?: string

    targetType?: 'video' | 'album' | 'folder'

    payload?: Record<string, unknown>

  } | null>(null)



  const selectedCount = computed(() => selectedIds.value.size)



  function toggleSelect(id: string) {

    const next = new Set(selectedIds.value)

    if (next.has(id)) next.delete(id)

    else next.add(id)

    selectedIds.value = next

  }



  function selectAll(ids: string[]) {

    selectedIds.value = new Set(ids)

  }



  function clearSelection(exitBatch = false) {

    selectedIds.value = new Set()

    if (exitBatch) manageMode.value = false

  }



  function showToast(message: string, type = 'info') {

    toast.value = { message, type }

    setTimeout(() => {

      if (toast.value?.message === message) toast.value = null

    }, 3000)

  }



  function showNonStandardDialog(opts: { reason?: string; remuxable?: boolean }) {

    return new Promise<'remux' | 'potplayer' | 'cancel'>((resolve) => {

      nonStandardReason.value = opts.reason || '该视频为碎片化 MP4，浏览器无法直连。'

      nonStandardRemuxable.value = !!opts.remuxable

      nonStandardOpen.value = true

      nonStandardResolver = resolve

    })

  }



  function resolveNonStandard(choice: 'remux' | 'potplayer' | 'cancel') {

    nonStandardOpen.value = false

    if (nonStandardResolver) {

      nonStandardResolver(choice)

      nonStandardResolver = null

    }

  }



  function openAlbumPicker(ids: string[]) {

    albumPickerIds.value = ids

    albumPickerOpen.value = true

  }



  function closeAlbumPicker() {

    albumPickerOpen.value = false

    albumPickerIds.value = []

  }

  function lockModalScroll(lock: boolean) {
    document.documentElement.classList.toggle('lg-modal-open', lock)
  }

  function showThumbPicker(data: {
    videoId: string
    subtitle?: string
    candidates: ThumbCandidate[]
    version: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      thumbPickerVideoId.value = data.videoId
      thumbPickerSubtitle.value = data.subtitle || ''
      thumbPickerCandidates.value = data.candidates
      thumbPickerVersion.value = data.version
      thumbPickerOpen.value = true
      thumbPickerResolver = resolve
      lockModalScroll(true)
    })
  }

  function closeThumbPicker(picked = false) {
    thumbPickerOpen.value = false
    thumbPickerVideoId.value = null
    thumbPickerSubtitle.value = ''
    thumbPickerCandidates.value = []
    thumbPickerVersion.value = ''
    lockModalScroll(false)
    if (thumbPickerResolver) {
      thumbPickerResolver(picked)
      thumbPickerResolver = null
    }
  }

  function openFolderMove(payload: NonNullable<typeof folderMovePayload.value>) {
    folderMovePayload.value = payload
    folderMoveOpen.value = true
  }

  function closeFolderMove() {
    folderMoveOpen.value = false
    folderMovePayload.value = null
  }



  function showContextMenu(

    e: MouseEvent,

    items: ContextMenuItem[],

    meta: { targetId?: string; targetType?: 'video' | 'album' | 'folder'; payload?: Record<string, unknown> },

  ) {

    e.preventDefault()

    contextMenu.value = {

      x: e.clientX,

      y: e.clientY,

      items,

      ...meta,

    }

  }



  function hideContextMenu() {

    contextMenu.value = null

  }



  return {

    manageMode,

    selectedIds,

    settingsOpen,

    toast,

    nonStandardOpen,

    nonStandardReason,

    nonStandardRemuxable,

    albumPickerOpen,

    albumPickerIds,

    thumbFailedOpen,

    thumbProgressExpanded,

    thumbPickerOpen,

    thumbPickerVideoId,
    thumbPickerSubtitle,
    thumbPickerCandidates,
    thumbPickerVersion,

    folderMoveOpen,

    folderMovePayload,

    contextMenu,

    selectedCount,

    toggleSelect,

    selectAll,

    clearSelection,

    showToast,

    showNonStandardDialog,

    resolveNonStandard,

    openAlbumPicker,

    closeAlbumPicker,
    showThumbPicker,
    closeThumbPicker,
    openFolderMove,
    closeFolderMove,

    showContextMenu,

    hideContextMenu,

  }

})

