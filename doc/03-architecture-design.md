# 03 — 目标架构设计

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Vue 3 SPA)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ Pages   │ │Components│ │ Stores  │ │Composables│           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘            │
│       └───────────┴───────────┴───────────┘                  │
│                         │ api/client.ts                      │
└─────────────────────────┼───────────────────────────────────┘
                          │ HTTP / SSE
┌─────────────────────────▼───────────────────────────────────┐
│              FastAPI (backend/src/loc_gallery)               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ routers/  libraries · videos · play · thumbs · ...   │   │
│  └────────────────────────┬─────────────────────────────┘   │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │ scanner  │thumb_mgr │hls_mgr   │media_probe│ stores  │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      视频库目录      data/*.json      data/cache/
```

---

## 2. 前端模块划分

### 2.1 Pages（页面视图）

| 文件 | 对应 viewMode | 职责 |
|------|---------------|------|
| `BrowsePage.vue` | browse | 画廊浏览主页面 |
| `FavoritesPage.vue` | favorites | 收藏视图 |
| `HistoryPage.vue` | history | 历史视图 |
| `AlbumsPage.vue` | albums | 专辑列表 |
| `AlbumDetailPage.vue` | album-detail | 专辑详情 |

路由配置：

```typescript
const routes = [
  { path: '/', name: 'browse', component: BrowsePage },
  { path: '/favorites', name: 'favorites', component: FavoritesPage },
  { path: '/history', name: 'history', component: HistoryPage },
  { path: '/albums', name: 'albums', component: AlbumsPage },
  { path: '/albums/:id', name: 'album-detail', component: AlbumDetailPage },
]
```

### 2.2 Layouts（布局）

| 文件 | 职责 |
|------|------|
| `AppLayout.vue` | 顶栏 + 侧栏 + 主内容区 |
| `PlayerLayout.vue` | 全屏播放器布局 |

### 2.3 Components（组件）

```
components/
├── layout/
│   ├── AppHeader.vue          # 顶栏（导航/搜索/库切换/状态芯片）
│   ├── CategorySidebar.vue    # 分类侧栏
│   ├── ThumbProgressBar.vue   # 缩略图进度条
│   └── BatchActionBar.vue     # 批量操作底栏
├── gallery/
│   ├── VideoGrid.vue          # 视频网格（虚拟滚动）
│   ├── VideoCard.vue          # 视频卡片
│   ├── FolderTree.vue         # 子目录树
│   ├── Breadcrumb.vue         # 面包屑
│   └── Pagination.vue         # 分页控件
├── player/
│   ├── PlayerView.vue         # 播放器主视图
│   ├── PlayerControls.vue     # 播放控件
│   ├── PlayerPlaylist.vue     # 右侧播放列表
│   ├── PlayOverlay.vue        # 加载/修复遮罩
│   └── HlsPlayer.vue          # HLS 播放器封装
├── album/
│   ├── AlbumGrid.vue          # 专辑网格
│   ├── AlbumCard.vue          # 专辑卡片
│   └── AlbumFormDialog.vue    # 专辑表单
├── dialogs/
│   ├── SettingsDialog.vue     # 设置（4 标签页）
│   ├── RenameDialog.vue       # 重命名
│   ├── MoveDialog.vue         # 移动
│   ├── AlbumPickerDialog.vue  # 专辑选择器
│   ├── ThumbPickerDialog.vue  # 缩略图候选
│   ├── NonstandardDialog.vue  # 非标准格式
│   └── FailedListDialog.vue   # 失败列表
├── context-menus/
│   ├── VideoContextMenu.vue   # 视频右键
│   ├── AlbumContextMenu.vue   # 专辑右键
│   └── FolderContextMenu.vue  # 文件夹右键
└── ui/                        # shadcn-vue 基础组件
    ├── Button.vue
    ├── Dialog.vue
    ├── Dropdown.vue
    ├── Input.vue
    ├── Select.vue
    ├── Toast.vue
    └── ...
```

### 2.4 Stores（Pinia）

| Store | 职责 | 关键状态 |
|-------|------|----------|
| `useLibraryStore` | 库管理 | libraries, activeLibraryId |
| `useGalleryStore` | 画廊浏览 | category, folder, query, sort, randomSeed, page, videos |
| `usePlayerStore` | 播放器 | playingId, playlist, playlistSort, playlistRandomSeed, hlsInstance, playSession |
| `useFavoriteStore` | 收藏 | favoritedIds |
| `useAlbumStore` | 专辑 | albums, currentAlbum |
| `useSettingsStore` | 设置 | settings, theme |
| `useUiStore` | UI 状态 | manageMode, selectedIds, dialogs |

### 2.5 Composables

| 文件 | 职责 |
|------|------|
| `useApi.ts` | API 请求封装 |
| `useSSE.ts` | SSE 连接与事件处理 |
| `usePlayback.ts` | 播放流程（direct/hls/external/remux） |
| `useHlsThrottle.ts` | HLS 切片节流 |
| `useResumePlayback.ts` | 断点续播 |
| `useKeyboardShortcuts.ts` | 键盘快捷键 |
| `useTheme.ts` | 主题切换 |
| `useUrlState.ts` | URL 参数同步 |
| `useContextMenu.ts` | 右键菜单 |
| `useBatchSelect.ts` | 批量选择 |

### 2.6 API 层

```
api/
├── client.ts          # 基础请求（自动附加 library_id）
├── libraries.ts       # 库管理 API
├── categories.ts      # 分类 API
├── folders.ts         # 文件夹 API
├── videos.ts          # 视频列表 API
├── favorites.ts       # 收藏 API
├── history.ts         # 历史 API
├── albums.ts          # 专辑 API
├── thumbs.ts          # 缩略图 API
├── play.ts            # 播放 API
├── settings.ts        # 设置 API
├── files.ts           # 文件操作 API
└── events.ts          # SSE 类型定义
```

---

## 3. 后端 Router 拆分

### 3.1 拆分方案

原 `server.py`（~1403 行）拆分为：

| Router 文件 | 端点数 | 原行范围（约） |
|-------------|--------|----------------|
| `routers/libraries.py` | 6 | 库 CRUD + pick-folder |
| `routers/categories.py` | 4 | 分类排序 |
| `routers/folders.py` | 4 | 文件夹操作 |
| `routers/videos.py` | 8 | 视频列表 + 格式 + 时长 |
| `routers/favorites.py` | 3 | 收藏 |
| `routers/history.py` | 4 | 历史 |
| `routers/albums.py` | 10 | 专辑 |
| `routers/thumbs.py` | 14 | 缩略图 |
| `routers/play.py` | 12 | 播放 + HLS + remux |
| `routers/files.py` | 5 | 文件操作 + rescan |
| `routers/settings.py` | 4 | 设置 + health + restart |
| `routers/events.py` | 1 | SSE |

### 3.2 精简后的 server.py

```python
# server.py（目标 ~200 行）
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .routers import (
    libraries, categories, folders, videos,
    favorites, history, albums, thumbs,
    play, files, settings, events
)
from .lifecycle import lifespan  # 启动/关闭逻辑

app = FastAPI(lifespan=lifespan)

# 注册路由
app.include_router(libraries.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
# ... 其他 router

# 静态文件（生产模式托管 frontend/dist）
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def index():
    return FileResponse("frontend/dist/index.html")
```

---

## 4. 状态流转

### 4.1 画廊浏览流

```
用户选择分类
  → galleryStore.setCategory(name)
  → galleryStore.loadFolders()
  → galleryStore.loadVideos()
  → VideoGrid 渲染

用户搜索
  → galleryStore.setQuery(q)
  → debounce 300ms
  → galleryStore.loadVideos()

SSE version 事件
  → debounce 500ms
  → galleryStore.reloadCategories()
  → galleryStore.reloadVideos()
```

### 4.2 播放流

```
用户点击播放
  → playerStore.playVideo(id)
  → usePlayback.start()
    → GET /api/play/info/{id}
    → 根据 mode 分支:
      - direct → video.src = /api/stream/{id}
      - hls → prepare → waitReady → hls.js
      - external → NonstandardDialog
      - unsupported → confirm PotPlayer
  → playerStore.revealPlayerView()
  → useResumePlayback.startSaving()
  → POST /api/history/record

用户切换视频
  → playSession++
  → POST /api/play/stop
  → 重复上述流程
```

### 4.3 HLS 切片节流

```
hls.js 播放中
  → useHlsThrottle 轮询 /api/play/status
  → buffered > 30s → POST /api/play/pause
  → buffered < 10s → POST /api/play/resume
  → seek 事件 → POST /api/play/catchup
```

---

## 5. 类型定义

### 5.1 核心类型（`types/index.ts`）

```typescript
interface Video {
  id: string
  title: string
  filename: string
  path: string
  category: string
  subfolder: string
  size: number
  mtime: number
  thumbStatus: 'ready' | 'missing' | 'generating' | 'failed'
  thumbReady: boolean
  thumbError?: string
  thumbVersion: number
  favorited: boolean
  favoritedAt?: number
  playedAt?: number
  playCount: number
  playPosition: number
  playDuration: number
  durationSec?: number
  albumIds: string[]
  formatBadge?: string
}

interface Library {
  id: string
  alias: string
  path: string
  created_at: number
  order: number
}

interface Album {
  id: string
  name: string
  description: string
  cover_video_id?: string
  video_count: number
  total_duration_sec?: number
  created_at: number
  updated_at: number
}

interface Category {
  name: string
  count: number
  starred?: boolean
}

interface PlayInfo {
  id: string
  title: string
  mode: 'direct' | 'hls' | 'external' | 'unsupported'
  remuxable: boolean
  playPosition: number
  codec?: string
  structure?: string
}

interface Settings {
  thumb_position: number
  thumb_workers: number
  thumb_idle_scan: boolean
  thumb_progress_bar: 'auto' | 'always' | 'never'
  default_page_size: number
  potplayer_path: string
  player_mode: 'html5' | 'potplayer' | 'smart'
  html5_playlist_autoplay: boolean
  html5_resume_playback: boolean
  html5_wheel_seek_sec: number
  html5_player_prev_key: string
  html5_player_next_key: string
  ui_theme: 'dark' | 'light'
  // ... 完整列表见 01-project-analysis.md §8
}

type ViewMode = 'browse' | 'favorites' | 'history' | 'albums' | 'album-detail'
type SortMode = 'page' | 'random' | 'filename_asc' | 'filename_desc' | 'title_asc' | 'title_desc' | 'mtime_desc' | 'mtime_asc' | 'size_desc' | 'size_asc'
```

---

## 6. 构建与部署

### 6.1 开发模式

```powershell
# 终端 1：后端
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m uvicorn loc_gallery.server:app --host 127.0.0.1 --port 3458 --reload

# 终端 2：前端
cd F:\Loc-Gallery-Vue\frontend
npm run dev  # Vite 代理 /api → :3458
```

### 6.2 生产构建

```powershell
cd F:\Loc-Gallery-Vue\frontend
npm run build  # → frontend/dist/

cd F:\Loc-Gallery-Vue
python restart.py  # 后端托管 dist/，监听 :3460
```

### 6.3 Vite 配置要点

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 3457,
    proxy: {
      '/api': 'http://127.0.0.1:3458',
      '/static': 'http://127.0.0.1:3458',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
```
