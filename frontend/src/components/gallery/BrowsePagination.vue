<script setup lang="ts">
import { computed, ref } from 'vue'
import { defaultPageSizeForPreset, useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  customPageSize: string
}>()

const emit = defineEmits<{
  pageSizeChange: [size: number]
  customPageSize: [event: KeyboardEvent]
  'update:customPageSize': [value: string]
  changePage: [page: number]
  jumpPage: [page: number]
}>()

const gallery = useGalleryStore()
const settings = useSettingsStore()
const jumpPage = ref('')

const defaultPageSize = computed(() => defaultPageSizeForPreset(settings.preset))
const pageSizePresets = computed(() => [defaultPageSize.value])
const showBar = computed(
  () => gallery.totalPages > 1 || gallery.pageSize !== defaultPageSize.value,
)
function onCustomInput(e: Event) {
  emit('update:customPageSize', (e.target as HTMLInputElement).value)
}

function onJumpKey(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const n = parseInt(jumpPage.value, 10)
  if (!Number.isFinite(n)) return
  jumpPage.value = ''
  emit('jumpPage', n)
}
</script>

<template>
  <nav v-if="showBar" class="pagination-bar">
    <div class="page-size-controls">
      <span class="page-size-label">每页</span>
      <button
        v-for="ps in pageSizePresets"
        :key="ps"
        type="button"
        class="page-size-btn"
        :class="{ active: gallery.pageSize === ps }"
        @click="emit('pageSizeChange', ps)"
      >
        {{ ps }}
      </button>
      <label class="page-size-custom">
        <input
          :value="customPageSize"
          type="number"
          min="1"
          max="999"
          class="page-size-input"
          placeholder="—"
          title="自定义每页条数，回车生效"
          @input="onCustomInput"
          @keydown="emit('customPageSize', $event)"
        />
        <span>条</span>
      </label>
    </div>

    <template v-if="gallery.totalPages > 1">
      <span class="pagination-sep" aria-hidden="true" />
      <button
        type="button"
        class="page-nav-btn"
        title="第一页"
        :disabled="gallery.page <= 1"
        @click="emit('changePage', 1)"
      >
        «
      </button>
      <button
        type="button"
        data-testid="prev-page"
        class="page-nav-btn"
        title="上一页"
        :disabled="gallery.page <= 1"
        @click="emit('changePage', gallery.page - 1)"
      >
        ◀ 上一页
      </button>
      <span class="page-info-text">第 {{ gallery.page }} / {{ gallery.totalPages }} 页</span>
      <button
        type="button"
        data-testid="next-page"
        class="page-nav-btn"
        title="下一页"
        :disabled="gallery.page >= gallery.totalPages"
        @click="emit('changePage', gallery.page + 1)"
      >
        下一页 ▶
      </button>
      <button
        type="button"
        class="page-nav-btn"
        title="最后一页"
        :disabled="gallery.page >= gallery.totalPages"
        @click="emit('changePage', gallery.totalPages)"
      >
        »
      </button>
      <label class="page-jump">
        跳至
        <input
          v-model="jumpPage"
          type="number"
          min="1"
          :max="gallery.totalPages"
          class="page-jump-input"
          @keydown="onJumpKey"
        />
        页
      </label>
    </template>
  </nav>
</template>
