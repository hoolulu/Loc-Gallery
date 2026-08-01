import { useUiStore } from '@/stores/ui'

import { useSettingsStore } from '@/stores/settings'

import { useGalleryStore } from '@/stores/gallery'

import { generateThumbCandidates, pickThumbCandidate } from '@/api/thumbs'

import { openThumbPicker } from '@/composables/useThumbPicker'



export async function regenerateThumbSmart(videoId: string) {

  const ui = useUiStore()

  const settings = useSettingsStore()

  const gallery = useGalleryStore()

  const autoBest = settings.settings?.thumb_auto_select_best !== false



  if (autoBest) {

    try {

      const res = await generateThumbCandidates(videoId)

      const cands = res.candidates || []

      if (!cands.length) {

        ui.showToast('未能生成候选缩略图')

        return false

      }

      const best = cands[0]

      await pickThumbCandidate(videoId, best.index)

      ui.showToast(`已自动选择最优帧（${Math.round(best.pos * 100)}%）`)

      await gallery.loadVideos()

      return true

    } catch {

      ui.showToast('自动选帧失败，请手动选择')

    }

  }



  const picked = await openThumbPicker(videoId)

  if (picked) await gallery.loadVideos()

  return picked

}


