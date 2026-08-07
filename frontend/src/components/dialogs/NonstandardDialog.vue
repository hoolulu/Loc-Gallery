<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

function choose(choice: 'remux' | 'external' | 'cancel') {
  ui.resolveNonStandard(choice)
}
</script>

<template>
  <dialog
    v-if="ui.nonStandardOpen"
    open
    class="fixed inset-0 z-[250] m-auto w-full max-w-md rounded-lg border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] p-0 text-[var(--lg-text-primary)] shadow-2xl backdrop:bg-black/60"
  >
    <div class="border-b border-[var(--lg-border)] px-4 py-3">
      <h2 class="text-lg font-medium">非标准格式</h2>
    </div>
    <p class="px-4 py-3 text-sm text-[var(--lg-text-secondary)]">{{ ui.nonStandardReason }}</p>
    <div class="flex flex-col gap-2 px-4 pb-4">
      <button
        v-if="ui.nonStandardRemuxable"
        class="rounded bg-[var(--lg-accent)] px-4 py-2 text-sm text-[var(--lg-text-on-accent)]"
        @click="choose('remux')"
      >
        流复制修复后播放
      </button>
      <button class="rounded border border-[var(--lg-border)] px-4 py-2 text-sm" @click="choose('external')">
        用外部播放器打开
      </button>
      <button class="rounded px-4 py-2 text-sm text-[var(--lg-text-muted)] lg-hover" @click="choose('cancel')">
        取消
      </button>
    </div>
  </dialog>
</template>
