<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getThumbFailed, regenerateFailed } from '@/api/thumbs'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const items = ref<{ id: string; title: string; error: string }[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const data = await getThumbFailed()
    items.value = data.items
  } finally {
    loading.value = false
  }
})

async function retryAll() {
  await regenerateFailed()
  ui.showToast('已加入重试队列')
  ui.thumbFailedOpen = false
}

function close() {
  ui.thumbFailedOpen = false
}
</script>

<template>
  <dialog
    v-if="ui.thumbFailedOpen"
    open
    class="fixed inset-0 z-[250] m-auto w-full max-w-lg rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] p-0 text-[var(--lg-text-primary)] shadow-2xl backdrop:bg-black/60"
  >
    <div class="flex items-center justify-between border-b border-[var(--lg-border)] px-4 py-3">
      <h2 class="text-lg font-medium">缩略图失败列表</h2>
      <button class="rounded px-2 py-1 lg-hover" @click="close">✕</button>
    </div>
    <div class="max-h-80 overflow-y-auto p-3 text-sm">
      <p v-if="loading" class="text-[var(--lg-text-muted)]">加载中…</p>
      <p v-else-if="!items.length" class="text-[var(--lg-text-muted)]">暂无失败项</p>
      <div v-for="item in items" :key="item.id" class="mb-2 rounded border border-[var(--lg-border)] p-2">
        <div class="font-medium">{{ item.title }}</div>
        <div class="text-xs text-red-400">{{ item.error }}</div>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t border-[var(--lg-border)] px-4 py-3">
      <button class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm" @click="close">关闭</button>
      <button
        v-if="items.length"
        class="rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)]"
        @click="retryAll"
      >
        全部重试
      </button>
    </div>
  </dialog>
</template>
