import type { ThemePreset } from '@/stores/settings'

export const PREFS_KEYS = {
  theme: 'loc-gallery-theme',
  preset: 'loc-gallery-preset',
  sort: 'loc-gallery-sort',
  pageSize: 'loc-gallery-page-size',
  randomSeed: 'loc-gallery-random-seed',
  settingsTab: 'loc-gallery-settings-tab',
  browse: 'loc-gallery-browse',
} as const

export type BrowseState = {
  category: string | null
  folder: string | null
}

export function getSavedBrowseState(): BrowseState {
  try {
    const raw = localStorage.getItem(PREFS_KEYS.browse)
    if (!raw) return { category: null, folder: null }
    const data = JSON.parse(raw) as Partial<BrowseState>
    return {
      category: data.category ?? null,
      folder: data.folder ?? null,
    }
  } catch {
    return { category: null, folder: null }
  }
}

export function setSavedBrowseState(state: BrowseState) {
  localStorage.setItem(
    PREFS_KEYS.browse,
    JSON.stringify({ category: state.category, folder: state.folder }),
  )
}

export const DEFAULT_THEME: 'light' | 'dark' = 'light'
export const DEFAULT_PRESET: ThemePreset = 'youtube'

export function normalizePreset(value: string | null | undefined): ThemePreset {
  return value === 'netflix' ? 'netflix' : 'youtube'
}

export function getSavedTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(PREFS_KEYS.theme)
  if (saved === 'light' || saved === 'dark') return saved
  return DEFAULT_THEME
}

export function setSavedTheme(theme: 'light' | 'dark') {
  localStorage.setItem(PREFS_KEYS.theme, theme)
}

export function getSavedPreset(): ThemePreset {
  const saved = localStorage.getItem(PREFS_KEYS.preset)
  if (saved) return normalizePreset(saved)
  return DEFAULT_PRESET
}

export function setSavedPreset(preset: ThemePreset) {
  localStorage.setItem(PREFS_KEYS.preset, preset)
}

export function pageSizeKey(preset: ThemePreset) {
  return `${PREFS_KEYS.pageSize}-${preset}`
}
