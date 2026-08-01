<script setup lang="ts">
import { ref } from 'vue'
import { thumbCandidateUrl } from '@/api/client'

import { generateThumbCandidates, pickThumbCandidate } from '@/api/thumbs'

import type { ThumbCandidate } from '@/api/thumbs'

import { useGalleryStore } from '@/stores/gallery'

import { useUiStore } from '@/stores/ui'



const ui = useUiStore()

const gallery = useGalleryStore()



const loading = ref(false)

const picking = ref(false)



async function selectCandidate(c: ThumbCandidate) {

  if (!ui.thumbPickerVideoId || picking.value) return

  picking.value = true

  try {

    await pickThumbCandidate(ui.thumbPickerVideoId, c.index)

    ui.showToast(`已选择 ${Math.round(c.pos * 100)}% 位置`)

    ui.closeThumbPicker(true)

    await gallery.loadVideos()

  } catch {

    ui.showToast('应用缩略图失败')

  } finally {

    picking.value = false

  }

}



async function reroll() {

  if (!ui.thumbPickerVideoId) return

  loading.value = true

  try {

    const res = await generateThumbCandidates(ui.thumbPickerVideoId, true)

    ui.thumbPickerCandidates = res.candidates || []

    ui.thumbPickerVersion = res.version || String(Date.now())

  } finally {

    loading.value = false

  }

}



function close() {

  ui.closeThumbPicker(false)

}

</script>



<template>

  <Teleport to="body">

    <div

      v-if="ui.thumbPickerOpen"

      class="lg-modal-overlay"

      @click.self="close"

    >

      <div class="thumb-picker-panel" role="dialog" aria-modal="true" @click.stop>

        <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-4 py-3">

          <div class="min-w-0">

            <h2 class="text-lg font-medium">选择缩略图</h2>

            <p v-if="ui.thumbPickerSubtitle" class="truncate text-xs text-[var(--lg-text-muted)]">

              {{ ui.thumbPickerSubtitle }}

            </p>

          </div>

          <button class="shrink-0 rounded px-2 py-1 lg-hover" type="button" @click="close">✕</button>

        </div>



        <p class="px-4 py-2 text-sm text-[var(--lg-text-muted)]">点击选择一张作为缩略图</p>



        <div class="thumb-picker-grid px-4 pb-4">

          <button

            v-for="c in ui.thumbPickerCandidates"

            :key="c.index"

            type="button"

            class="thumb-picker-item"

            :disabled="picking || loading"

            @click="selectCandidate(c)"

          >

            <img

              :src="thumbCandidateUrl(ui.thumbPickerVideoId!, c.index, ui.thumbPickerVersion)"

              :alt="`${Math.round(c.pos * 100)}%`"

              class="aspect-video w-full object-cover"

            />

            <div class="py-1 text-center text-xs">{{ Math.round(c.pos * 100) }}%</div>

          </button>

        </div>



        <div class="flex justify-end gap-2 border-t border-[var(--lg-border)] px-4 py-3">

          <button

            type="button"

            class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm lg-hover"

            :disabled="loading || picking"

            @click="reroll"

          >

            {{ loading ? '生成中…' : '换一批' }}

          </button>

          <button

            type="button"

            class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm lg-hover"

            @click="close"

          >

            取消

          </button>

        </div>

      </div>

    </div>

  </Teleport>

</template>
