# 07 — 主题系统设计

---

## 1. 设计原则

1. **布局与配色解耦**：用户可选「Netflix 布局 + 蓝色强调」
2. **CSS Variables 驱动**：所有颜色/间距/圆角通过变量定义
3. **暗/亮模式独立**：每套主题各有一套暗/亮变量集
4. **Tailwind 映射**：Tailwind 配置引用 CSS Variables
5. **零运行时开销**：主题切换仅改 `data-theme` 和 `data-preset` 属性

---

## 2. CSS Variables 体系

### 2.1 命名规范

前缀 `--lg-`（Loc Gallery），分类：

```
--lg-bg-*          背景色
--lg-text-*        文字色
--lg-border-*      边框色
--lg-accent-*      强调色
--lg-btn-*         按钮色
--lg-shadow-*      阴影
--lg-radius-*      圆角
--lg-spacing-*     间距（可选）
```

### 2.2 基础令牌（暗色）

```css
:root, [data-theme="dark"] {
  color-scheme: dark;

  /* 背景 */
  --lg-bg: #0f0f0f;
  --lg-bg-elevated: #212121;
  --lg-bg-secondary: #181818;
  --lg-bg-tertiary: #303030;
  --lg-bg-input: #303030;
  --lg-bg-hover: rgba(255, 255, 255, 0.1);
  --lg-bg-card: #1a1a1a;
  --lg-bg-sidebar: #0f0f0f;
  --lg-bg-header: #0f0f0f;
  --lg-bg-player: #000000;
  --lg-bg-overlay: rgba(0, 0, 0, 0.72);

  /* 文字 */
  --lg-text-primary: #f1f1f1;
  --lg-text-secondary: #aaaaaa;
  --lg-text-muted: #717171;
  --lg-text-inverse: #0f0f0f;

  /* 边框 */
  --lg-border: #303030;
  --lg-border-subtle: #3f3f3f;
  --lg-divider: rgba(255, 255, 255, 0.06);

  /* 强调色（由各 preset 覆盖） */
  --lg-accent: #e50914;
  --lg-accent-hover: #f40612;
  --lg-accent-muted: rgba(229, 9, 20, 0.15);

  /* 按钮 */
  --lg-btn-bg: #272727;
  --lg-btn-border: #3a3a3a;
  --lg-btn-bg-hover: #333333;
  --lg-btn-text: #f1f1f1;

  /* 阴影 */
  --lg-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --lg-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
  --lg-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5);
  --lg-shadow-card: 0 4px 16px rgba(0, 0, 0, 0.5);
  --lg-shadow-card-hover: 0 8px 24px rgba(0, 0, 0, 0.6);

  /* 圆角 */
  --lg-radius: 6px;
  --lg-radius-sm: 4px;
  --lg-radius-lg: 12px;
  --lg-radius-xl: 16px;

  /* 危险色 */
  --lg-danger: #ff4444;
  --lg-danger-bg: #2a1515;
  --lg-danger-border: #5c2020;

  /* 成功色 */
  --lg-success: #4caf50;

  /* 播放器 */
  --lg-player-controls-bg: rgba(0, 0, 0, 0.7);
  --lg-player-progress: var(--lg-accent);
  --lg-player-progress-bg: rgba(255, 255, 255, 0.2);

  /* 布局 */
  --lg-sidebar-width: 240px;
  --lg-header-height: 56px;
  --lg-player-bar-height: 72px;
}
```

### 2.3 亮色模式

```css
[data-theme="light"] {
  color-scheme: light;

  --lg-bg: #ffffff;
  --lg-bg-elevated: #ffffff;
  --lg-bg-secondary: #f9f9f9;
  --lg-bg-tertiary: #f2f2f2;
  --lg-bg-input: #ffffff;
  --lg-bg-hover: rgba(0, 0, 0, 0.05);
  --lg-bg-card: #ffffff;
  --lg-bg-sidebar: #ffffff;
  --lg-bg-header: #ffffff;
  --lg-bg-player: #000000;
  --lg-bg-overlay: rgba(0, 0, 0, 0.4);

  --lg-text-primary: #0f0f0f;
  --lg-text-secondary: #3f3f3f;
  --lg-text-muted: #5c5c5c;
  --lg-text-inverse: #ffffff;

  --lg-border: #e5e5e5;
  --lg-border-subtle: #d9d9d9;
  --lg-divider: rgba(0, 0, 0, 0.08);

  --lg-btn-bg: #f2f2f2;
  --lg-btn-border: #e0e0e0;
  --lg-btn-bg-hover: #e5e5e5;
  --lg-btn-text: #0f0f0f;

  --lg-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
  --lg-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.1);
  --lg-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);
  --lg-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.08);
  --lg-shadow-card-hover: 0 4px 16px rgba(0, 0, 0, 0.12);
}
```

---

## 3. 主题预设

### 3.1 Netflix 沉浸影院（默认）

```css
[data-preset="netflix"] {
  --lg-accent: #E50914;
  --lg-accent-hover: #F40612;
  --lg-accent-muted: rgba(229, 9, 20, 0.15);
  --lg-bg: #000000;
  --lg-bg-elevated: #141414;
  --lg-bg-card: #1a1a1a;
  --lg-radius: 4px;
  --lg-radius-lg: 8px;
}
```

**布局特征**：
- 顶部极简导航（Logo + 视图链接 + 搜索）
- Hero 横幅区（继续观看 / 推荐）
- 横向滚动内容行（按分类）
- 卡片 hover 放大 1.05 + 阴影
- 播放器全屏影院模式

**组件差异**：
- `BrowsePage` 使用 `HeroBanner` + `ContentRow` 替代传统网格
- 分类以横向滚动行呈现
- 无固定侧栏（侧栏内容收入顶栏下拉）

### 3.2 YouTube 经典

```css
[data-preset="youtube"] {
  --lg-accent: #FF0000;
  --lg-accent-hover: #CC0000;
  --lg-accent-muted: rgba(255, 0, 0, 0.1);
  --lg-bg: #0f0f0f;
  --lg-bg-sidebar: #0f0f0f;
  --lg-radius: 8px;
  --lg-radius-lg: 12px;
}
```

**布局特征**：
- 左侧固定分类栏（240px）
- 顶栏搜索 + 工具按钮
- 主区响应式网格（16:9 缩略图）
- 播放器弹层或全屏

**组件差异**：
- 最接近现有 v8.1.0 布局
- `CategorySidebar` + `VideoGrid` 标准组合

### 3.3 Spotify 专辑导向

```css
[data-preset="spotify"] {
  --lg-accent: #1DB954;
  --lg-accent-hover: #1ED760;
  --lg-accent-muted: rgba(29, 185, 84, 0.15);
  --lg-bg: #121212;
  --lg-bg-elevated: #1a1a1a;
  --lg-bg-sidebar: #000000;
  --lg-radius: 8px;
  --lg-radius-lg: 8px;
}
```

**布局特征**：
- 左侧窄导航（72px 图标 + 文字）
- 主区大列表 + 专辑封面网格（1:1）
- 底部固定迷你播放条（72px）
- 点击底部栏展开全屏播放器

**组件差异**：
- `MiniPlayerBar` 组件（底部固定）
- 专辑封面 1:1 比例
- `PlayerView` 从底部向上展开

---

## 4. Tailwind 配置映射

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: 'var(--lg-bg)',
        elevated: 'var(--lg-bg-elevated)',
        secondary: 'var(--lg-bg-secondary)',
        card: 'var(--lg-bg-card)',
        primary: 'var(--lg-text-primary)',
        muted: 'var(--lg-text-muted)',
        accent: {
          DEFAULT: 'var(--lg-accent)',
          hover: 'var(--lg-accent-hover)',
          muted: 'var(--lg-accent-muted)',
        },
        border: 'var(--lg-border)',
        danger: 'var(--lg-danger)',
      },
      borderRadius: {
        DEFAULT: 'var(--lg-radius)',
        lg: 'var(--lg-radius-lg)',
        xl: 'var(--lg-radius-xl)',
      },
      boxShadow: {
        card: 'var(--lg-shadow-card)',
        'card-hover': 'var(--lg-shadow-card-hover)',
        lg: 'var(--lg-shadow-lg)',
      },
    },
  },
}
```

---

## 5. 主题切换实现

### 5.1 Composable

```typescript
// composables/useTheme.ts
import { ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

type ThemeMode = 'dark' | 'light'
type ThemePreset = 'netflix' | 'youtube' | 'spotify'

const mode = ref<ThemeMode>('dark')
const preset = ref<ThemePreset>('netflix')

export function useTheme() {
  function apply() {
    document.documentElement.dataset.theme = mode.value
    document.documentElement.dataset.preset = preset.value
    localStorage.setItem('loc-gallery-theme', mode.value)
    localStorage.setItem('loc-gallery-preset', preset.value)
  }

  function setMode(m: ThemeMode) {
    mode.value = m
    apply()
    useSettingsStore().saveSettings({ ui_theme: m })
  }

  function setPreset(p: ThemePreset) {
    preset.value = p
    apply()
  }

  function init() {
    const saved = localStorage.getItem('loc-gallery-theme')
    const savedPreset = localStorage.getItem('loc-gallery-preset')
    if (saved === 'light' || saved === 'dark') mode.value = saved
    if (savedPreset) preset.value = savedPreset as ThemePreset
    apply()
  }

  return { mode, preset, setMode, setPreset, init }
}
```

### 5.2 布局模式切换

```typescript
// themes/layouts.ts
export const layoutComponents = {
  netflix: {
    browse: () => import('@/pages/netflix/BrowsePage.vue'),
    sidebar: null, // 无侧栏
    player: () => import('@/components/player/CinemaPlayer.vue'),
  },
  youtube: {
    browse: () => import('@/pages/youtube/BrowsePage.vue'),
    sidebar: () => import('@/components/layout/CategorySidebar.vue'),
    player: () => import('@/components/player/OverlayPlayer.vue'),
  },
  spotify: {
    browse: () => import('@/pages/spotify/BrowsePage.vue'),
    sidebar: () => import('@/components/layout/IconSidebar.vue'),
    player: () => import('@/components/player/MiniPlayerBar.vue'),
  },
}
```

### 5.3 设置页主题选择器

```
┌─────────────────────────────────────────┐
│  界面主题                                │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Netflix │ │ YouTube │ │ Spotify │   │
│  │  ████   │ │  ████   │ │  ████   │   │
│  │  预览图  │ │  预览图  │ │  预览图  │   │
│  └─────────┘ └─────────┘ └─────────┘   │
│                                         │
│  显示模式：  ○ 暗色   ○ 亮色            │
└─────────────────────────────────────────┘
```

---

## 6. 组件样式约定

### 6.1 视频卡片

```vue
<!-- 所有 preset 共用 VideoCard，通过 CSS 变量适配 -->
<div class="video-card group relative rounded-lg overflow-hidden
            bg-card shadow-card hover:shadow-card-hover
            transition-all duration-200
            hover:scale-[1.02]">
  <div class="aspect-video relative">
    <img :src="thumbUrl" class="w-full h-full object-cover" />
    <span class="absolute bottom-1 left-1 text-xs bg-black/80 px-1 rounded">
      {{ duration }}
    </span>
  </div>
  <div class="p-2">
    <h3 class="text-sm text-primary line-clamp-2">{{ title }}</h3>
  </div>
</div>
```

### 6.2 Preset 特定样式

```css
/* Netflix: 更大的 hover 放大 */
[data-preset="netflix"] .video-card:hover {
  transform: scale(1.05);
  z-index: 10;
}

/* Spotify: 方形封面 */
[data-preset="spotify"] .video-card .aspect-video {
  aspect-ratio: 1;
}

/* YouTube: 标准 16:9，无额外效果 */
```

---

## 7. 实施优先级

| 阶段 | 内容 |
|------|------|
| M7.1 | CSS Variables 基础体系 + 暗/亮模式 |
| M7.2 | YouTube preset（最接近现有，验证体系） |
| M7.3 | Netflix preset（默认主题） |
| M7.4 | Spotify preset（底部播放条） |
| M7.5 | 设置页主题选择器 + 预览 |

---

## 8. 迁移对照

| 现有变量 (--yt-*) | 新变量 (--lg-*) |
|-------------------|-----------------|
| --yt-bg | --lg-bg |
| --yt-bg-elevated | --lg-bg-elevated |
| --yt-text-primary | --lg-text-primary |
| --yt-accent | --lg-accent |
| --yt-border | --lg-border |
| --yt-radius | --lg-radius |
| --yt-shadow-card | --lg-shadow-card |

现有 `style.css` 中的 `--yt-*` 变量在重构时全部替换为 `--lg-*`，不保留旧命名。
