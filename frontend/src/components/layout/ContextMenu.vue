<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

function onClick(action: string) {
  const menu = ui.contextMenu
  ui.hideContextMenu()
  if (!menu) return
  document.dispatchEvent(
    new CustomEvent('lg-context-action', {
      detail: { action, ...menu },
    }),
  )
}

function onGlobalClick() {
  ui.hideContextMenu()
}

onMounted(() => document.addEventListener('click', onGlobalClick))
onUnmounted(() => document.removeEventListener('click', onGlobalClick))
</script>

<template>
  <div
    v-if="ui.contextMenu"
    class="fixed z-[400] min-w-40 rounded border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] py-1 text-sm shadow-lg"
    :style="{ left: `${ui.contextMenu.x}px`, top: `${ui.contextMenu.y}px` }"
    @click.stop
  >
    <button
      v-for="item in ui.contextMenu.items"
      :key="item.action"
      class="block w-full px-3 py-1.5 text-left lg-hover disabled:opacity-40"
      :class="{ 'text-red-400': item.danger }"
      :disabled="item.disabled"
      @click="onClick(item.action)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
