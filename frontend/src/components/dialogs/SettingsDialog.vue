<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useGalleryStore } from '@/stores/gallery'
import { useAlbumStore } from '@/stores/album'
import { useLibraryStore } from '@/stores/library'
import {
  clearHistory,
  createLibrary,
  deleteLibrary,
  pickFolder,
  restartService,
  updateLibrary,
} from '@/api/files'
import type { Settings } from '@/types'

const ui = useUiStore()
const settings = useSettingsStore()
const library = useLibraryStore()
const gallery = useGalleryStore()
const album = useAlbumStore()

type SettingsTab = 'library' | 'playback' | 'thumbnail' | 'other'
const TAB_KEY = 'loc-gallery-settings-tab'

const tab = ref<SettingsTab>((localStorage.getItem(TAB_KEY) as SettingsTab) || 'library')
const settingsScope = ref<'global' | 'library'>('global')
const form = reactive<Partial<Settings>>({})
const newLib = reactive({ alias: '', path: '' })
const pageSizeMode = ref<'40' | '80' | 'custom'>('40')
const customPageSize = ref('40')

const presets = [
  { value: 'netflix', label: '影院（白底全宽）' },
  { value: 'youtube', label: '经典（侧栏网格）' },
]

const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'library', label: '视频库' },
  { id: 'playback', label: '播放' },
  { id: 'thumbnail', label: '缩略图' },
  { id: 'other', label: '其他' },
]

watch(tab, (v) => localStorage.setItem(TAB_KEY, v))

onMounted(async () => {
  await library.loadLibraries()
  await settings.loadSettings()
  Object.assign(form, settings.settings || {})
  syncPageSizeFromForm()
})

watch(
  () => form.ui_theme,
  (v) => {
    if (v === 'light' || v === 'dark') settings.previewTheme(v)
  },
)

watch(
  () => form.ui_preset,
  (v) => {
    if (v === 'netflix' || v === 'youtube') settings.previewPreset(v)
  },
)

function syncPageSizeFromForm() {
  const n = form.default_page_size
  if (n === 40) pageSizeMode.value = '40'
  else if (n === 80) pageSizeMode.value = '80'
  else {
    pageSizeMode.value = 'custom'
    customPageSize.value = String(n ?? 40)
  }
}

function applyPageSizeToForm() {
  if (pageSizeMode.value === '40') form.default_page_size = 40
  else if (pageSizeMode.value === '80') form.default_page_size = 80
  else form.default_page_size = parseInt(customPageSize.value, 10) || 40
}

async function save() {
  applyPageSizeToForm()
  await settings.updateSettings({ ...form }, settingsScope.value)
  ui.showToast('设置已保存')
}

async function pickPath() {
  const res = await pickFolder()
  if (res.path) newLib.path = res.path
}

async function addLibrary() {
  if (!newLib.alias || !newLib.path) return
  await createLibrary(newLib.alias, newLib.path)
  newLib.alias = ''
  newLib.path = ''
  await library.loadLibraries()
}

async function saveLibraryRow(lib: { id: string; alias: string; path: string }) {
  await updateLibrary(lib.id, { alias: lib.alias, path: lib.path })
  ui.showToast('已保存')
}

async function onRemoveLibrary(id: string, alias: string) {
  if (!confirm(`确定删除视频库「${alias}」？`)) return
  await deleteLibrary(id)
  await library.loadLibraries()
  gallery.clearFolderCaches()
  gallery.category = null
  gallery.folder = null
  gallery.page = 1
  await gallery.loadCategories()
  await gallery.loadVideos()
  await album.loadAlbums()
  ui.showToast('已删除视频库')
}

async function onRestart() {
  if (!confirm('确定重启服务？')) return
  const before = await fetch('/api/health').then((r) => r.json()).catch(() => null)
  await restartService()
  ui.showToast('服务重启中…')
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const after = await fetch('/api/health').then((r) => r.json())
      if (after?.ok && after.boot_id !== before?.boot_id) {
        ui.showToast('服务已重启')
        return
      }
    } catch {
      /* wait */
    }
  }
  ui.showToast('重启已排队，请稍后刷新')
}

async function onClearHistory() {
  if (!confirm('确定清空播放记录？')) return
  await clearHistory()
  ui.showToast('已清空')
}

function close() {
  settings.revertPreview()
  ui.settingsOpen = false
  document.documentElement.classList.remove('lg-modal-open')
}

watch(
  () => ui.settingsOpen,
  (open) => {
    document.documentElement.classList.toggle('lg-modal-open', open)
    if (open) {
      void settings.loadSettings().then(() => {
        Object.assign(form, settings.settings || {})
        syncPageSizeFromForm()
      })
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.settingsOpen" class="lg-modal-overlay" @click.self="close">
      <div class="settings-dialog" role="dialog" aria-modal="true" @click.stop>
        <header class="settings-topbar">
          <h2>设置</h2>
          <span class="settings-topbar-hint">
            {{ settingsScope === 'global' ? '全局设置' : '当前库设置' }}
          </span>
        </header>

        <div class="settings-shell">
          <nav class="settings-sidebar" aria-label="设置分类">
            <button
              v-for="t in tabs"
              :key="t.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: tab === t.id }"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </nav>

          <div class="settings-body">
            <!-- 视频库 -->
            <template v-if="tab === 'library'">
              <section class="settings-block">
                <h3 class="settings-block-title">视频库管理</h3>
                <p class="settings-subtitle">现有视频库</p>
                <div v-if="library.libraries.length" class="lib-table">
                  <div class="lib-table-head">
                    <span>别名</span>
                    <span>文件夹路径</span>
                    <span class="lib-col-actions">操作</span>
                  </div>
                  <div class="lib-table-body">
                    <div v-for="lib in library.libraries" :key="lib.id" class="lib-table-row">
                      <input v-model="lib.alias" class="settings-input settings-input--compact" />
                      <div class="lib-path-cell">
                        <input v-model="lib.path" class="settings-input settings-input--compact" />
                      </div>
                      <div class="lib-col-actions">
                        <button type="button" class="settings-btn" @click="saveLibraryRow(lib)">保存</button>
                        <button
                          type="button"
                          class="settings-btn settings-btn--danger"
                          @click="onRemoveLibrary(lib.id, lib.alias)"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="lib-empty">暂无视频库，请在下方添加</div>

                <p class="settings-subtitle" style="margin-top: 1rem">新增视频库</p>
                <div class="lib-table-row lib-add-row">
                  <input
                    v-model="newLib.alias"
                    placeholder="别名"
                    class="settings-input settings-input--compact"
                    autocomplete="off"
                  />
                  <div class="lib-path-cell">
                    <input
                      v-model="newLib.path"
                      placeholder="文件夹路径"
                      class="settings-input settings-input--compact"
                      autocomplete="off"
                    />
                    <button type="button" class="settings-btn" @click="pickPath">浏览</button>
                  </div>
                  <div class="lib-col-actions">
                    <button type="button" class="settings-btn settings-btn--primary" @click="addLibrary">
                      添加
                    </button>
                  </div>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">外观</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">界面主题</span>
                    <select v-model="form.ui_theme" class="settings-input">
                      <option value="dark">夜间</option>
                      <option value="light">白天</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">布局风格</span>
                    <select v-model="form.ui_preset" class="settings-input">
                      <option v-for="p in presets" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                  </label>
                </div>
              </section>
            </template>

            <!-- 播放 -->
            <template v-else-if="tab === 'playback'">
              <section class="settings-block">
                <h3 class="settings-block-title">播放</h3>
                <div class="settings-grid">
                  <label class="settings-field">
                    <span class="settings-field-label">续播</span>
                    <select v-model="form.html5_resume_playback" class="settings-input">
                      <option :value="true">开</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">连播</span>
                    <select v-model="form.html5_playlist_autoplay" class="settings-input">
                      <option :value="true">开</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">后台自动修复</span>
                    <select v-model="form.html5_auto_remux" class="settings-input">
                      <option :value="true">开（空闲时自动重封装可修复文件）</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">预览浮层消失方式</span>
                    <select v-model="form.html5_hover_tip_pin" class="settings-input">
                      <option :value="true">按关闭按钮才消失（默认）</option>
                      <option :value="false">移开鼠标自动消失</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">进度条悬停截图</span>
                    <select v-model="form.html5_seek_preview" class="settings-input">
                      <option :value="true">开（悬停进度条显示时间点画面）</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">外部播放器路径</span>
                    <input
                      v-model="form.external_player_path"
                      class="settings-input"
                      placeholder="自动检测 PotPlayer"
                    />
                  </label>
                  <div class="settings-field settings-field--full">
                    <p class="settings-field-hint">
                      浏览器无法硬解的视频（如 mpeg2/VC-1/WMV）会提示用外部播放器打开；可填 VLC、MPC-HC 等任意播放器 exe 路径。
                    </p>
                  </div>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">快捷键与操作</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">上一集键</span>
                    <input v-model="form.html5_player_prev_key" class="settings-input" maxlength="12" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">下一集键</span>
                    <input v-model="form.html5_player_next_key" class="settings-input" maxlength="12" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">滚轮快进</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_wheel_seek_sec"
                        type="number"
                        min="0"
                        max="120"
                        class="settings-input"
                      />
                      <span class="settings-unit">秒</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">悬停预览</span>
                    <select v-model="form.html5_hover_preview" class="settings-input">
                      <option :value="true">开（多段视频预览）</option>
                      <option :value="false">关（仅静态缩略图）</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">预览段数</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_hover_preview_segments"
                        type="number"
                        min="1"
                        max="10"
                        class="settings-input"
                      />
                      <span class="settings-unit">段</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">每段时长</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.html5_hover_preview_segment_sec"
                        type="number"
                        min="1"
                        max="15"
                        class="settings-input"
                      />
                      <span class="settings-unit">秒</span>
                    </div>
                  </label>
                  <div class="settings-field settings-field--full">
                    <span class="settings-field-label">播放器内置快捷键</span>
                    <select v-model="form.html5_disable_movi_hotkeys" class="settings-input">
                      <option :value="true">关闭（推荐，避免与油猴脚本冲突）</option>
                      <option :value="false">开启（空格/方向键/z/x 等由播放器接管）</option>
                    </select>
                    <p class="settings-field-hint">
                      关闭后键盘操作完全交给页面级脚本（如油猴 HTML5 增强），画面上的控件不受影响。
                    </p>
                  </div>
                </div>
              </section>
            </template>

            <!-- 缩略图 -->
            <template v-else-if="tab === 'thumbnail'">
              <section class="settings-block">
                <h3 class="settings-block-title">缩略图生成</h3>
                <div class="settings-grid">
                  <label class="settings-field">
                    <span class="settings-field-label">截图位置</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.thumb_position"
                        type="number"
                        step="0.05"
                        min="0.05"
                        max="0.95"
                        class="settings-input"
                      />
                      <span class="settings-unit">比例</span>
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">空闲扫描</span>
                    <select v-model="form.thumb_idle_scan" class="settings-input">
                      <option :value="true">开</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">进度条</span>
                    <select v-model="form.thumb_progress_bar" class="settings-input">
                      <option value="auto">活动时显示</option>
                      <option value="always">始终显示</option>
                      <option value="never">始终隐藏</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">并发数</span>
                    <input v-model.number="form.thumb_workers" type="number" min="1" max="8" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">候选图数量</span>
                    <input
                      v-model.number="form.thumb_candidate_count"
                      type="number"
                      min="3"
                      max="12"
                      class="settings-input"
                    />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">单选自动最优</span>
                    <select v-model="form.thumb_auto_select_best" class="settings-input">
                      <option :value="true">开</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">批量自动最优</span>
                    <select v-model="form.thumb_batch_auto_select" class="settings-input">
                      <option :value="true">开</option>
                      <option :value="false">关</option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">随机偏移 (±%)</span>
                    <input v-model.number="form.thumb_jitter_pct" type="number" min="5" max="15" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">偏移下限 %</span>
                    <input v-model.number="form.thumb_jitter_min" type="number" min="3" max="12" class="settings-input" />
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">偏移上限 %</span>
                    <input v-model.number="form.thumb_jitter_max" type="number" min="88" max="97" class="settings-input" />
                  </label>
                </div>
              </section>
            </template>

            <!-- 其他 -->
            <template v-else>
              <section class="settings-block">
                <h3 class="settings-block-title">通用</h3>
                <div class="settings-grid settings-grid--2">
                  <label class="settings-field">
                    <span class="settings-field-label">默认每页</span>
                    <div class="flex gap-2">
                      <select v-model="pageSizeMode" class="settings-input">
                        <option value="40">40 张</option>
                        <option value="80">80 张</option>
                        <option value="custom">自定义</option>
                      </select>
                      <input
                        v-if="pageSizeMode === 'custom'"
                        v-model="customPageSize"
                        type="number"
                        min="1"
                        max="999"
                        class="settings-input"
                        style="width: 5rem"
                        placeholder="条数"
                      />
                    </div>
                  </label>
                  <label class="settings-field">
                    <span class="settings-field-label">历史保留</span>
                    <div class="settings-unit-row">
                      <input
                        v-model.number="form.history_retention_days"
                        type="number"
                        min="1"
                        max="3650"
                        class="settings-input"
                      />
                      <span class="settings-unit">天</span>
                    </div>
                  </label>
                </div>
              </section>

              <section class="settings-block">
                <h3 class="settings-block-title">维护</h3>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" class="settings-btn" @click="onClearHistory">清空播放记录</button>
                  <button type="button" class="settings-btn" @click="onRestart">重启服务</button>
                  <span class="settings-field-hint">缩略图并发数需重启服务生效</span>
                </div>
              </section>
            </template>
          </div>
        </div>

        <footer class="settings-footer">
          <select v-model="settingsScope" class="settings-input" style="width: auto; min-width: 8rem">
            <option value="global">全局设置</option>
            <option value="library">当前库设置</option>
          </select>
          <div class="flex gap-2">
            <button type="button" class="settings-btn" @click="close">取消</button>
            <button type="button" class="settings-btn settings-btn--primary" @click="save">保存</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
