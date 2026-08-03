<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const menuRef = ref<HTMLElement | null>(null)
const menuPos = ref({ x: 0, y: 0 })

const VIEWPORT_PAD = 8

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - width - VIEWPORT_PAD
  const maxY = window.innerHeight - height - VIEWPORT_PAD
  let left = x
  let top = y

  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, x - width)
  }
  if (left > maxX) left = Math.max(VIEWPORT_PAD, maxX)
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD

  if (top + height > window.innerHeight - VIEWPORT_PAD) {
    top = Math.max(VIEWPORT_PAD, y - height)
  }
  if (top > maxY) top = Math.max(VIEWPORT_PAD, maxY)
  if (top < VIEWPORT_PAD) top = VIEWPORT_PAD

  return { x: left, y: top }
}

async function updateMenuPosition() {
  const menu = ui.contextMenu
  if (!menu) return
  menuPos.value = { x: menu.x, y: menu.y }
  await nextTick()
  const el = menuRef.value
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  menuPos.value = clampMenuPosition(menu.x, menu.y, width, height)
}

watch(
  () => ui.contextMenu,
  (menu) => {
    if (!menu) return
    void updateMenuPosition()
  },
)

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

function onViewportChange() {
  if (ui.contextMenu) void updateMenuPosition()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<template>
  <div
    v-if="ui.contextMenu"
    ref="menuRef"
    class="context-menu fixed z-[400] min-w-40 max-h-[min(70vh,24rem)] overflow-y-auto rounded border border-[var(--lg-border)] bg-[var(--lg-bg-elevated)] py-1 text-sm shadow-lg"
    :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
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
