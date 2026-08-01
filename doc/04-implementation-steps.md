# 04 — 详细实施步骤

> 本文档为 Agent 执行的主要任务清单，按阶段顺序执行，每阶段完成后按验收标准自检。

---

## 阶段 0：文档与准备 ✅

**状态**：已完成

- [x] 创建 `F:\Loc-Gallery-Vue\doc\` 目录
- [x] 编写全部 10 份文档
- [ ] 用户审阅确认

**下一步**：等待用户确认后开始阶段 1

---

## 阶段 1：脚手架搭建

### 1.1 创建前端项目

```powershell
cd F:\Loc-Gallery-Vue
npm create vite@latest frontend -- --template vue-ts
cd frontend
npm install
npm install pinia vue-router @vueuse/core
npm install -D tailwindcss @tailwindcss/vite
npm install hls.js
npm install -D @types/hls.js
npm install -D vitest @vue/test-utils jsdom
npm install -D @playwright/test
```

### 1.2 配置 Tailwind CSS 4

- 创建 `tailwind.config.ts`，配置 content 路径
- 在 `vite.config.ts` 添加 `@tailwindcss/vite` 插件
- 创建 `src/assets/main.css`，引入 Tailwind

### 1.3 安装 shadcn-vue

```powershell
npx shadcn-vue@latest init
# 选择 New York 风格、Zinc 色系、CSS Variables
npx shadcn-vue@latest add button dialog dropdown-menu input select toast
```

### 1.4 复制后端与联接数据

```powershell
# 复制后端
xcopy /E /I F:\Loc-Gallery\src F:\Loc-Gallery-Vue\backend\src
xcopy /E /I F:\Loc-Gallery\tests F:\Loc-Gallery-Vue\backend\tests
copy F:\Loc-Gallery\pyproject.toml F:\Loc-Gallery-Vue\backend\
copy F:\Loc-Gallery\requirements.txt F:\Loc-Gallery-Vue\backend\

# 开发期：联接源项目 data（复用缩略图/收藏/历史，见 11-data-migration.md）
cd F:\Loc-Gallery-Vue
cmd /c mklink /J data F:\Loc-Gallery\data
```

### 1.5 配置开发环境

- 创建 `frontend/vite.config.ts` 代理配置
- 创建 `scripts/dev.ps1` 并行启动脚本
- 创建根目录 `restart.py`（指向 backend）

### 1.6 创建基础骨架

- `src/App.vue` — 路由出口
- `src/layouts/AppLayout.vue` — 空布局
- `src/main.ts` — Pinia + Router 初始化
- `src/router/index.ts` — 路由定义

### 1.7 验收

```powershell
# 后端
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m uvicorn loc_gallery.server:app --port 3458
# 访问 http://127.0.0.1:3458/api/health → { ok: true }

# 前端
cd F:\Loc-Gallery-Vue\frontend
npm run dev
# 访问 http://127.0.0.1:3457 → 空白页无报错
```

**检查项**：
- [ ] 后端 `/api/health` 返回 ok
- [ ] 后端 `/api/libraries` 返回源项目现有库
- [ ] 后端 `/api/videos` 返回视频且 `thumbReady=true`（缩略图已复用）
- [ ] 前端 Vite dev server 启动无报错
- [ ] TypeScript 编译无错误
- [ ] Tailwind 样式生效

---

## 阶段 2：API 层与状态管理

### 2.1 创建类型定义

文件：`src/types/index.ts`

按 `03-architecture-design.md` §5.1 定义所有接口类型。

### 2.2 实现 API 客户端

文件：`src/api/client.ts`

```typescript
// 核心逻辑（对照 app.js L753-780）
const BASE = '/api'

export async function api<T>(
  path: string,
  options?: RequestInit & { params?: Record<string, string> }
): Promise<T> {
  const libraryId = useLibraryStore().activeLibraryId
  const url = new URL(BASE + path, window.location.origin)
  if (libraryId) url.searchParams.set('library_id', libraryId)
  if (options?.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}
```

### 2.3 实现所有 API 模块

按 `05-api-mapping.md` 逐文件实现，每个 API 函数对应一个端点。

优先级：
1. `libraries.ts` — 库列表
2. `settings.ts` — 设置读写
3. `categories.ts` — 分类
4. `videos.ts` — 视频列表
5. 其余按依赖顺序

### 2.4 创建 Pinia Stores

| Store | 先实现的方法 |
|-------|-------------|
| `useLibraryStore` | loadLibraries, switchLibrary, activeLibraryId |
| `useSettingsStore` | loadSettings, saveSettings, theme |
| `useGalleryStore` | loadCategories, loadVideos, setCategory, setPage |
| `useUiStore` | manageMode, selectedIds, openDialog |

### 2.5 实现 SSE Composable

文件：`src/composables/useSSE.ts`

对照 `app.js` L6261-6298：
- 连接 `/api/events?library_id=...`
- 解析 `version:` 和 `progress:` 事件
- 断线 5s 重连
- 版本变更 debounce 500ms 触发重载

### 2.6 编写 API 层测试

```typescript
// tests/api/libraries.test.ts
describe('libraries API', () => {
  it('should fetch library list', async () => {
    const result = await getLibraries()
    expect(result).toHaveProperty('items')
  })
})
```

### 2.7 验收

- [ ] 所有 API 模块 TypeScript 编译通过
- [ ] `getLibraries()` 返回数据
- [ ] `getSettings()` 返回数据
- [ ] SSE 连接成功，收到 version 事件
- [ ] API 单元测试通过

---

## 阶段 3：核心画廊视图

### 3.1 AppHeader 组件

对照 `index.html` L20-84，实现：
- Logo
- 视图切换按钮（首页/收藏/历史/专辑）
- 库切换下拉（`library-select`）
- 搜索框（debounce 300ms）
- 批量按钮
- 主题切换按钮
- 设置按钮
- 时长/缩略图状态芯片
- 刷新按钮
- 缩略图进度条（可展开/折叠）

### 3.2 CategorySidebar 组件

对照 `index.html` L87-99 + `app.js` 分类相关函数：
- 分类列表渲染
- 排序模式下拉（custom/name_asc/name_desc/count_desc/count_asc）
- 拖拽排序（使用 VueDraggable 或原生实现）
- 分类点击 → 加载子目录树
- 文件夹树展开/折叠
- 分类/文件夹右键菜单触发

### 3.3 VideoGrid + VideoCard

对照 `app.js` 网格渲染逻辑：
- `@tanstack/vue-virtual` 虚拟滚动
- VideoCard 包含：
  - 缩略图（`/api/thumb/{id}?v={version}`）
  - 时长角标（左下角）
  - 格式角标（右上角）
  - 收藏按钮（悬停显示 ♥）
  - 专辑按钮（悬停显示 📁）
  - 标题（两行截断）
  - 批量选择复选框（manageMode 时）
- 点击卡片 → 播放
- 右键 → 上下文菜单

### 3.4 分页与排序

- Pagination 组件：页码、每页条数、跳转
- 排序下拉：page/random/filename_asc/desc/title_asc/desc/mtime_desc/asc/size_desc/asc（含 8.1.0「随机列表」）
- 工具栏「随机播放」按钮（8.1.0，`#btn-random-play`）
- `randomSeed` / `playlistRandomSeed` 状态与 localStorage 持久化（8.1.0）
- URL 状态同步（`useUrlState`）

### 3.5 面包屑与工具栏

- Breadcrumb：分类 > 子文件夹路径
- 工具栏：排序、每页条数、格式筛选

### 3.6 验收

对照 `06-feature-checklist.md` §3 画廊浏览：
- [ ] 分类侧栏显示正确
- [ ] 点击分类加载视频网格
- [ ] 缩略图正常显示
- [ ] 分页翻页正常
- [ ] 搜索过滤正常
- [ ] 排序切换正常
- [ ] 随机列表排序（sort=random + seed）
- [ ] 随机播放按钮
- [ ] URL 参数同步
- [ ] SSE 推送后自动刷新

---

## 阶段 4：播放器完整移植

> **最关键阶段**。逐函数对照 `app.js` 播放相关代码（L4500-5700）。

### 4.1 PlayerView 布局

对照 `index.html` 播放器区域 + `style.css` 播放器样式：
- 全屏覆盖层
- 左侧视频区域
- 右侧播放列表
- 底部控制栏（播放/暂停、进度条、音量、全屏）
- 顶部关闭按钮

### 4.2 播放策略检测

文件：`src/composables/usePlayback.ts`

对照 `app.js` `playVideoHtml5`（L4500-4580）：

```typescript
async function playVideo(id: string) {
  const session = ++playSession.value
  const info = await getPlayInfo(id)
  if (abortIfStale(session)) return

  switch (info.mode) {
    case 'direct':
      await playDirect(id, info, session)
      break
    case 'hls':
      await playHls(id, info, session)
      break
    case 'external':
      showNonstandardDialog(id, info)
      break
    case 'unsupported':
      confirmPotPlayer(id)
      break
  }
}
```

### 4.3 HTML5 直传播放

对照 `app.js` L4700-4760：
- `video.src = /api/stream/{id}`
- experimental 失败回退 HLS
- 绑定 ended/timeupdate 事件

### 4.4 HLS 播放

对照 `app.js` L4580-4700：
- `POST /api/play/prepare/{id}`
- 轮询 `GET /api/play/status/{id}` 直到 ready
- hls.js 加载 `/api/hls/{id}/index.m3u8`
- 实现 `useHlsThrottle`（L4580-4648）

### 4.5 断点续播

对照 `app.js` L4767-4880：
- 读取 `playPosition`，设置 `video.currentTime`
- 定时保存位置（每 10s + pause + pagehide）
- `POST /api/history/position`

### 4.6 播放列表与连播

对照 `app.js` L4861-4874 + 播放列表排序：
- 右侧播放列表渲染
- 排序下拉（含「随机」，8.1.0）
- `ended` 事件 → `playAdjacentVideo(1)`（若 autoplay 开启）
- 随机播放后播放列表自动切为随机排序（8.1.0）
- 上一集/下一集按钮

### 4.7 Remux 修复

对照 `app.js` L5609-5655：
- `POST /api/videos/{id}/remux`
- 轮询 `GET /api/videos/{id}/remux`
- 进度遮罩显示
- 完成后重新播放

### 4.8 PotPlayer 外部播放

对照 `app.js` `playVideoExternal`：
- `POST /api/play-external/{id}`

### 4.9 键盘快捷键

对照 `app.js` L6955-6975 + L4952-4978：
- Escape 取消播放
- `.` / `/` 上一集/下一集
- 滚轮快进/快退
- Media Session API

### 4.10 验收

对照 `06-feature-checklist.md` §4 播放系统：
- [ ] 标准 MP4 直传播放
- [ ] 大文件 HLS 播放
- [ ] 特殊编码 HLS 转码播放
- [ ] 伪装 TS 格式播放
- [ ] 断点续播（关闭重开恢复位置）
- [ ] 播放列表连播
- [ ] 播放列表随机排序（8.1.0）
- [ ] 随机播放联动（8.1.0）
- [ ] 上一集/下一集
- [ ] Remux 修复流程
- [ ] PotPlayer 外部播放
- [ ] 键盘快捷键全部生效
- [ ] pagehide 保存位置 + 停止切片

---

## 阶段 5：收藏/历史/专辑

### 5.1 FavoritesPage

- 调用 `GET /api/videos?favorites=true`
- 复用 VideoGrid + VideoCard
- 收藏按钮切换

### 5.2 HistoryPage

- 调用 `GET /api/videos?history=true`
- 显示播放时间和次数

### 5.3 AlbumsPage

- 调用 `GET /api/albums`
- AlbumGrid + AlbumCard 组件
- 新建专辑按钮 → AlbumFormDialog
- 专辑右键菜单

### 5.4 AlbumDetailPage

- 调用 `GET /api/albums/{id}` + `GET /api/videos?album_id=`
- 专辑信息头（封面/名称/描述/时长）
- 播放全部按钮
- 视频网格

### 5.5 专辑操作对话框

- AlbumFormDialog：新建/编辑
- AlbumPickerDialog：选择加入的专辑
- 封面设置

### 5.6 验收

对照 `06-feature-checklist.md` §5-6：
- [ ] 收藏视图正常
- [ ] 收藏切换即时反馈
- [ ] 历史视图按时间排序
- [ ] 专辑 CRUD
- [ ] 视频加入/移出专辑
- [ ] 专辑详情播放全部
- [ ] 播放器内加入专辑

---

## 阶段 6：设置与批量管理

### 6.1 SettingsDialog

4 个标签页，对照 `index.html` 设置对话框：

| 标签 | 设置项 |
|------|--------|
| 视频库 | 库列表 CRUD、添加库、文件夹选择器 |
| 播放 | player_mode、续播、连播、快捷键、滚轮、HLS 选项 |
| 缩略图 | 位置、并发、空闲扫描、候选数、自动选优 |
| 其他 | 主题、历史保留天数、默认每页、重启服务 |

### 6.2 批量选择模式

对照 `app.js` manageMode 逻辑：
- 顶栏「批量」按钮切换
- 卡片显示复选框
- 底部 BatchActionBar 浮出
- 全选/取消全选

### 6.3 批量操作

- 批量删除 → `POST /api/videos/delete`
- 批量移动 → MoveDialog
- 批量收藏 → `POST /api/favorites/batch`
- 批量加入专辑 → AlbumPickerDialog
- 批量修复 MP4 → remux batch begin/end

### 6.4 右键菜单

3 个上下文菜单，对照 `app.js` 右键逻辑：

**视频右键**：
- 播放、收藏、加入专辑
- 重命名、移动、删除
- 打开文件夹、换缩略图
- 修复为标准 MP4

**专辑右键**：
- 编辑、删除、播放全部

**文件夹右键**：
- 重命名、移动、删除

### 6.5 对话框

- RenameDialog
- MoveDialog（分类选择）
- MoveFolderDialog（文件夹树选择）
- ThumbPickerDialog（候选帧网格）
- NonstandardDialog（remux / PotPlayer）
- FailedListDialog（失败列表 + 重试）

### 6.6 验收

对照 `06-feature-checklist.md` §7-9：
- [ ] 设置 4 标签页全部可保存
- [ ] 库添加/编辑/删除/切换
- [ ] 批量选择模式
- [ ] 批量删除/移动/收藏/修复
- [ ] 3 个右键菜单完整
- [ ] 所有对话框正常
- [ ] 服务重启功能

---

## 阶段 7：主题系统

### 7.1 CSS Variables 设计令牌

按 `07-theme-design.md` 定义 `--lg-*` 变量体系。

### 7.2 实现 3 套主题预设

优先级：
1. Netflix（默认）
2. YouTube Classic
3. Spotify

### 7.3 暗/亮模式

- 每套主题各一套暗/亮变量
- 顶栏切换按钮
- 同步 `settings.ui_theme` + localStorage

### 7.4 主题切换 UI

- 设置页主题选择器（预览缩略图）
- 即时切换无刷新

### 7.5 验收

- [ ] 3 套主题可切换
- [ ] 暗/亮模式正常
- [ ] 主题持久化
- [ ] 所有组件在新主题下无样式破损

---

## 阶段 8：集成测试与最终验收

### 8.1 Playwright E2E 测试

```typescript
// e2e/gallery.spec.ts
test('should browse categories and play video', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.category-item').first()).toBeVisible()
  await page.locator('.category-item').first().click()
  await expect(page.locator('.video-card').first()).toBeVisible()
  await page.locator('.video-card').first().click()
  await expect(page.locator('video')).toBeVisible()
})
```

测试覆盖：
- 画廊浏览 + 翻页
- 搜索
- 播放（至少 direct 模式）
- 收藏切换
- 设置保存
- 主题切换

### 8.2 功能清单逐项验收

打开 `06-feature-checklist.md`，逐项勾选，失败项记录并修复。

### 8.3 性能验证

- 1000+ 视频库首次加载 < 3s
- 翻页 < 500ms
- 虚拟滚动无卡顿

### 8.4 生产构建

```powershell
cd F:\Loc-Gallery-Vue\frontend
npm run build
cd F:\Loc-Gallery-Vue
python restart.py
# 访问 http://127.0.0.1:3460
```

### 8.5 最终验收

- [ ] `06-feature-checklist.md` 全部勾选
- [ ] E2E 测试全部通过
- [ ] 无 P0/P1 bug
- [ ] 生产构建正常运行
- [ ] `restart.py` 一键启动

---

## 附录：源文件对照索引

实施时按此索引查找原始逻辑：

| 新模块 | 源文件 | 源行范围 |
|--------|--------|----------|
| `api/client.ts` | `app.js` | L753-780 |
| `useSSE.ts` | `app.js` | L6261-6298 |
| `usePlayback.ts` | `app.js` | L4500-4580 |
| `useHlsThrottle.ts` | `app.js` | L4580-4648 |
| `useResumePlayback.ts` | `app.js` | L4767-4880 |
| `VideoGrid` | `app.js` | L3200-3400 |
| `VideoCard` | `app.js` | L3400-3600 |
| `CategorySidebar` | `app.js` | L2700-2900 |
| `PlayerView` | `app.js` + `index.html` | L4500-5200 |
| `SettingsDialog` | `index.html` + `app.js` | L5800-6200 |
| `BatchActionBar` | `app.js` | L3800-4000 |
| `btn-random-play` | `app.js` | L6480-6512 |
| 右键菜单 | `app.js` | L4000-4300 |
| 键盘快捷键 | `app.js` | L6955-6975 |
