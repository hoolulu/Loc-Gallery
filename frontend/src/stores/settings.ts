import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSettings, saveSettings } from '@/api'
import type { Settings } from '@/types'
import {
  DEFAULT_PRESET,
  DEFAULT_THEME,
  getSavedPreset,
  getSavedTheme,
  normalizePreset,
  setSavedPreset,
  setSavedTheme,
} from '@/utils/userPrefs'

export type ThemePreset = 'netflix' | 'youtube'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | null>(null)
  const theme = ref<'dark' | 'light'>(DEFAULT_THEME)
  const preset = ref<ThemePreset>(DEFAULT_PRESET)

  function applyDom() {
    document.documentElement.dataset.theme = theme.value
    document.documentElement.dataset.preset = preset.value
  }

  /** 启动时从 localStorage 恢复，不请求服务器 */
  function bootstrapTheme() {
    theme.value = getSavedTheme()
    preset.value = getSavedPreset()
    applyDom()
  }

  async function loadSettings() {
    settings.value = await getSettings()
    theme.value = getSavedTheme()
    preset.value = getSavedPreset()
    applyDom()
  }

  function previewTheme(next: 'dark' | 'light') {
    theme.value = next
    applyDom()
  }

  function previewPreset(next: ThemePreset) {
    preset.value = next
    applyDom()
  }

  function revertPreview() {
    theme.value = getSavedTheme()
    preset.value = getSavedPreset()
    applyDom()
  }

  async function updateSettings(data: Partial<Settings>, scope: 'global' | 'library' = 'global') {
    const payload = { ...data }
    if (payload.ui_preset === 'spotify' as string) payload.ui_preset = 'netflix'
    settings.value = await saveSettings(payload, scope)
    if (data.ui_theme === 'light' || data.ui_theme === 'dark') {
      theme.value = data.ui_theme
      setSavedTheme(data.ui_theme)
    }
    if (data.ui_preset) {
      preset.value = normalizePreset(data.ui_preset)
      setSavedPreset(preset.value)
    }
    applyDom()
  }

  async function setPreset(next: ThemePreset) {
    preset.value = next
    setSavedPreset(next)
    applyDom()
    try {
      await updateSettings({ ui_preset: next })
    } catch {
      /* 本地已持久化，服务器失败不阻断 */
    }
  }

  async function toggleTheme() {
    const next = theme.value === 'dark' ? 'light' : 'dark'
    theme.value = next
    setSavedTheme(next)
    applyDom()
    try {
      await updateSettings({ ui_theme: next })
    } catch {
      /* 本地已持久化 */
    }
  }

  return {
    settings,
    theme,
    preset,
    bootstrapTheme,
    loadSettings,
    updateSettings,
    setPreset,
    toggleTheme,
    previewTheme,
    previewPreset,
    revertPreview,
  }
})
