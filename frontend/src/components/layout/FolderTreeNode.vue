<script setup lang="ts">
import type { FolderNode } from '@/types'
import { useGalleryStore } from '@/stores/gallery'
import FolderTreeNode from './FolderTreeNode.vue'

defineProps<{
  node: FolderNode
  category: string
  depth: number
}>()

const emit = defineEmits<{
  select: [category: string, path: string]
  contextmenu: [event: MouseEvent, category: string, path: string]
}>()

const gallery = useGalleryStore()

function onSelect(category: string, path: string) {
  emit('select', category, path)
}
</script>

<template>
  <div>
    <button
      class="flex w-full items-center gap-1 rounded py-1.5 text-left text-xs transition lg-hover"
      :class="{ 'lg-active': gallery.folder === node.path }"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      @click="onSelect(category, node.path)"
      @contextmenu.prevent="emit('contextmenu', $event, category, node.path)"
    >
      <span
        v-if="node.children?.length"
        class="inline-block w-3 text-[10px] transition"
        :class="{ 'rotate-90': gallery.expandedFolders.has(node.path) }"
        @click.stop="gallery.toggleFolderExpanded(node.path)"
      >▶</span>
      <span v-else class="w-3" />
      <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
      <span class="text-[var(--lg-text-muted)]">{{ node.total }}</span>
    </button>
    <div v-if="node.children?.length && gallery.expandedFolders.has(node.path)">
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :category="category"
        :depth="depth + 1"
        @select="onSelect"
        @contextmenu="(e, c, p) => emit('contextmenu', e, c, p)"
      />
    </div>
  </div>
</template>
