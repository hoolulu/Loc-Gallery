# Loc Gallery 产品需求文档（PRD）

| 字段 | 内容 |
|------|------|
| 版本 | 5.0.3 |
| 日期 | 2026-07-25 |
| 状态 | 开发版（主分支） |
| 服务地址 | `http://127.0.0.1:3456`（本地） |

---

## 1. 产品概述

### 1.1 背景

用户拥有大量本地视频文件（含特殊伪装格式），需要一个**仅在本机运行**的 Web 画廊：快速浏览、搜索、分类管理，并在浏览器内可靠播放，必要时可调用外部播放器。

### 1.2 产品定位

**Loc Gallery** 是一款面向 Windows 的本地视频画廊服务：

- 后端：Python + FastAPI + ffmpeg
- 前端：原生 HTML/CSS/JS + Tailwind CSS + hls.js
- 部署：单机本地，无云依赖、无用户系统

### 1.3 目标用户

- 个人本地视频库管理者
- 需要浏览大量分类目录、偶尔批量整理文件的用户

### 1.4 非目标

- 多用户 / 远程访问 / 权限体系
- 移动端 App
- 视频转码入库、刮削元数据（如 TMDB）
- 在线分享或公网部署

---

## 2. 核心用户故事

| ID | 作为用户，我希望… | 验收标准 |
|----|------------------|----------|
| US-01 | 打开浏览器即可浏览全部视频缩略图 | 首页加载分类与网格，缩略图按需生成 |
| US-02 | 按分类、子目录、关键词筛选 | 侧栏分类 + 文件夹树 + 搜索框联动 |
| US-03 | 在页面内直接播放视频 | HTML5 播放器弹层，支持进度、音量、全屏 |
| US-04 | 大文件 / 特殊编码也能快速起播 | 自动选择 direct / HLS copy / HLS 转码策略 |
| US-05 | 伪装成 PNG 的 MPEG-TS 能正常播放 | 识别 PNG 头 + TS 负载，HLS copy 切片 |
| US-06 | 新拷入的视频自动出现在画廊 | 文件监听触发重扫、缩略图排队、策略探测 |
| US-07 | 管理分类显示顺序与星标 | 拖拽排序、星标置顶、多种排序模式 |
| US-08 | 批量删除 / 重命名 / 移动视频 | 多选 + 确认对话框，操作后刷新索引 |
| US-09 | 必要时用外部播放器打开 | 设置可选外部播放器 / HTML5 内嵌 |
| US-10 | 一键重启服务 | `restart.py` 先停后起并打开浏览器 |
| US-11 | 管理多个本地视频库 | 注册/切换/编辑库路径；数据按库隔离 |
| US-12 | 追剧时按文件名顺序连播 | 播放列表排序 + HTML5 播完自动下一集 |
| US-13 | 下次打开从上次位置继续看 | HTML5 续播进度持久化 |
| US-14 | 把视频整理成主题专辑 | 顶栏「我的专辑」：新建/编辑/删除；视频可多专辑归属；封面默认首条视频缩略图 |
| US-15 | 快速找到特殊格式或需修复的文件 | 顶栏格式筛选 + 卡片角标；后台 `format_index` 持久化索引 |
| US-16 | 浏览时看到每个视频时长 | 卡片左下角时长；后台 ffprobe 逐条探测并写入缩略图索引 |
| US-17 | 白天/夜间切换界面主题 | 顶栏与设置页切换 `ui_theme`（dark/light），同步服务器与 localStorage |
| US-18 | 碎片化 H.264 MP4 一键修复 | 右键/批量「修复为标准 MP4」；流复制 remux，保留时间戳与缩略图 |
| US-19 | 不退出程序即可重启后端 | 设置页「重启服务」；`boot_id` 两阶段检测，独立子进程 stop→start |
| US-20 | 收藏与专辑归属有即时反馈 | 卡片 ♥/📁 状态、播放器内收藏与「加入专辑」按钮随操作更新 |

---

## 3. 系统架构

### 3.1 逻辑架构

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器 (static/)                      │
│  index.html · app.js · style.css · hls.js               │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────┐
│              FastAPI (loc_gallery.server)                │
│  API · 静态文件 · SSE 事件推送                            │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ scanner  │thumb_mgr │hls_mgr   │media_probe│category/    │
│          │          │          │          │favorite/    │
│          │          │          │          │history/     │
│          │          │          │          │album_store  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬──────┘
     │          │          │          │            │
     ▼          ▼          ▼          ▼            ▼
  视频库     data/.thumbs  data/cache  playback    data/*.json
                         /hls        _plans.json
```

### 3.2 目录与职责

| 路径 | 职责 |
|------|------|
| `src/loc_gallery/` | Python 后端源码包 |
| `static/` | 前端静态资源 |
| `scripts/` | 重启脚本、CSS 构建 |
| `config/` | 配置模板 |
| `data/` | 运行时数据（gitignored） |
| `tests/` | 单元与集成测试（含多库隔离、专辑、文件稳定性） |

### 3.3 技术栈

| 层级 | 技术 |
|------|------|
| Web 框架 | FastAPI 0.115+、uvicorn |
| 文件监听 | watchdog 6+ |
| 媒体处理 | ffmpeg、ffprobe |
| 前端 | 原生 ES6+、Tailwind CSS 3、hls.js |
| 运行时 | Python 3.11+、Windows |

---

## 4. 功能需求

### 4.1 视频扫描与索引

**FR-01 扫描范围**

- 支持多个视频库根目录（`data/libraries.json` + `library_store`）
- 每个库递归扫描其 `path`；`config.VIDEO_ROOT` 仅作默认库种子
- 识别常见视频扩展名；忽略项目自身目录、缓存目录等

**FR-02 视频元数据**

每条记录包含：`id`（路径哈希）、`path`、`filename`、`title`（从文件名提取）、`category`（一级子目录名）、`size`、`mtime`

**FR-03 手动刷新**

- 顶部「刷新」按钮调用 `POST /api/rescan`
- 文件系统变更时 watchdog 自动触发 `refresh_cache`

### 4.2 画廊浏览

**FR-04 网格展示**

- 默认每页 32 条；支持**自适应**（按窗口列数计算）、自定义条数、「全部」
- 卡片显示缩略图、标题、格式角标、时长（左下角）、收藏 ♥（右上）
- 已在专辑中的视频显示 📁 角标（左下）；悬停时右上角显示勾选框；批量模式下可多选

**FR-04a 顶栏视图**

| 视图 | URL | 说明 |
|------|-----|------|
| 首页浏览 | `/` 或 `?category=` | 默认分类/搜索网格 |
| 我的收藏 | `?view=favorites` | 仅收藏视频，按收藏时间排序 |
| 最近播放 | `?view=history` | 按播放时间倒序 |
| 我的专辑 | `?view=albums` | 专辑卡片网格 |
| 专辑详情 | `?view=album&album_id=` | 专辑内视频网格，顺序按专辑 `position` |

收藏、最近播放、专辑三种筛选**互斥**，不可与 `album_id` / `favorites` / `history` 参数混用。

**FR-04b 格式筛选**

- 顶栏下拉：可修复、需转码、HLS、多段交错、伪装格式、moov 在末尾、大文件、碎片化、无法播放、任意非标准等
- 后台 `format_index` 持久化索引；筛选时若索引未完成，顶栏提示后台扫描中
- 卡片角标与筛选键一致；本页 remux 成功的项显示「已修复」

**FR-05 搜索**

- 支持标题、文件名、分类关键词模糊匹配

**FR-06 排序**

- 视频：最新/最旧、名称、大小、分类
- 分类：自定义拖拽、名称、数量

**FR-07 子目录浏览**

- 选中分类后，侧栏下方展示该分类的子目录树
- 面包屑导航，可逐级进入子目录

### 4.3 分类管理

**FR-08 星标分类** — 星标分类置顶，持久化于 `data/category_meta.json`

**FR-09 自定义排序** — 侧栏分类列表支持拖拽（⋮⋮ 握把）

**FR-10 排序模式** — 自定义 / 名称 / 数量，多种升降序

### 4.4 缩略图系统

**FR-11 生成策略**

- 默认在视频时长 60% 处截图（可配置）
- 支持随机截图范围、并发 worker 数

**FR-12 队列与进度**

- 当前页视频高优先级排队
- 顶栏显示全局进度条、暂停/继续
- `thumb_idle_scan=false` 时仅按需生成；开启后后台补全全库

**FR-13 特殊格式**

- PNG 文件头 + MPEG-TS 内容：使用 `ffmpeg -f mpegts` 抽帧

**FR-14 失败处理** — 失败列表可查看、重试；支持清理孤儿缓存

**FR-14a 视频时长**

- 优先从缩略图目录 `index.json` 读取 `duration_sec`
- 未缓存时后台 ffprobe 逐条探测（2 路并行）；顶栏「时长」芯片显示剩余数量与速率
- 播放历史中的 `duration_sec` 可回填索引，避免重复探测
- 卡片左下角与播放列表副标题显示 `durationSec`

### 4.5 播放系统

**FR-15 播放模式**

| 设置 `player_mode` | 行为 |
|--------------------|------|
| `html5` | 页面内 `<video>` + hls.js |
| `potplayer` | 调用外部播放器 |

**FR-16 播放策略探测（media_probe）**

结果缓存于 `data/cache/playback_plans.json`（按路径 + mtime + size 校验）。

| 场景 | 策略 |
|------|------|
| 小体积标准 H.264 MP4 | `direct` 直传 |
| 碎片化 MP4 / moov 在末尾 | `hls` copy |
| 大文件（>300MB） | `hls` copy |
| AV1 / HEVC / VP9 | `hls` 转 H.264 |
| PNG 头 + MPEG-TS 负载 | `hls` copy，`input_format=mpegts` |
| 纯图片 / 无法解析 | `unsupported` |

**FR-17 HLS 缓存** — 切片存放 `data/libraries/{id}/cache/hls/`，LRU 淘汰，默认上限 5GB；片段时长 **30 秒**（`HLS_SEGMENT_SECONDS`）

**FR-17a HLS 切片进程控制**

- 播放器**暂停**时挂起 ffmpeg 进程（不终止），**继续播放**时恢复
- 切换视频、返回列表、调用 `/api/play/stop` 时终止进程并保留已生成缓存

**FR-18 播放器 UI** — 全屏播放页、右侧播放列表、探测/切片状态提示、外部播放与打开文件夹

**FR-18a 播放列表排序**

- 排序选项：列表顺序、文件名自然升/降序、标题、修改时间、文件大小
- 排序结果仅影响播放页列表与连播顺序，不改变画廊分页顺序
- 偏好保存在浏览器 `localStorage`（`playlistSort`）

**FR-18b HTML5 连播**

- 当前视频播放结束后，自动播放列表中下一项（HTML5 模式）
- 「上一个 / 下一个」按钮按当前列表排序顺序切换

**FR-18c HTML5 续播**

- 播放中定期保存 `position_sec`（及可选 `duration_sec`）至 `play_history.json`
- 再次播放：进度 &lt; 15 秒从头播；距结尾 &lt; 45 秒视为看完；否则从记录位置起播
- 直连使用 `video.currentTime`；HLS 使用 hls.js `startPosition`
- HLS 边切边播时，目标位置须已有对应片段（或等待切片追上）

**FR-18d 播放快捷键与 Media Session**

- 默认 `.` 上一集、`/` 下一集（设置可自定义）
- 支持系统媒体键（Media Session API）

**FR-18e 碎片化 MP4 修复（remux）**

- 识别 `formatBadge=remuxable` 的碎片化 H.264 MP4
- 右键或批量「修复为标准 MP4」：流复制 remux 为规范 MP4，原文件改名 `.bak`
- 批量修复期间 `POST /api/remux/batch/begin|end` 按库暂停文件监视，批次结束后统一恢复
- 修复后刷新索引与缩略图，角标变为「已修复」

### 4.6 收藏与播放历史

**FR-19a 收藏**

- 卡片 ♥、播放器「收藏」、右键菜单、批量加入/取消收藏
- 数据：`data/libraries/{id}/favorites.json`；删除视频时自动 prune
- `GET /api/videos?favorites=1`；响应含 `favorited`、`favoritedAt`

**FR-19b 播放历史**

- 打开播放时 `POST /api/history/record`；续播 `POST /api/history/position`
- `GET /api/videos?history=1` 按最近播放排序
- 设置页可清空；保留天数 `history_retention_days`

### 4.7 我的专辑

**FR-20a 专辑 CRUD**

- 顶栏「📁 我的专辑」进入专辑列表；左侧分类栏**保持可见**
- 新建 / 编辑（名称、描述）/ 删除专辑
- 「本页生成专辑」：将当前页全部视频加入新专辑
- 数据：`data/libraries/{id}/albums.json`（`albums` + `album_order` + 每专辑 `items`）

**FR-20b 成员与封面**

- 视频与专辑**多对多**；专辑内按 `position` 排序
- 加入方式：右键「加入专辑…」、批量「加入专辑」、播放器「📁 加入专辑」、勾选对话框
- 封面：可指定 `cover_video_id`；未指定时默认**position 最小**（通常第一个加入）的视频缩略图
- 专辑详情右键「设为专辑封面」

**FR-20c 专辑详情**

- 面包屑：我的专辑 / {名称}（视频数 · 总时长）
- 「播放全部」从专辑顺序第一集起播；播放列表 scope 含 `albumId`
- 删除视频时从所有专辑自动移除（`prune_missing` / `remove_video_from_all_albums`）

**不在本版范围**：导入/导出专辑 JSON、侧栏专辑快捷折叠区。

### 4.8 多视频库

**FR-22 库注册**

- `libraries.json` 存储库 ID、别名、路径、激活状态
- 设置页：现有库表格编辑、新增库（别名 + 路径一次性提交）
- Windows 下 `POST /api/libraries/pick-folder` 调用原生文件夹选择器

**FR-23 库级数据隔离**

每库独立目录 `data/libraries/{id}/`：

| 文件/目录 | 内容 |
|-----------|------|
| `favorites.json` | 收藏 |
| `play_history.json` | 播放历史（含 `position_sec` 续播进度） |
| `albums.json` | 用户专辑与成员关系 |
| `category_meta.json` | 分类星标与排序 |
| `.thumbs/` | 缩略图缓存 |
| `cache/hls/` | HLS 切片缓存 |
| `settings.json` | （遗留）单库升级前的库内设置，可迁移到全局 |

**FR-24 库切换**

- 顶栏下拉 + `POST /api/libraries/{id}/activate`
- 前端 URL `?lib=`；SSE / API 带 `library_id`

### 4.9 文件管理

**FR-19 删除** — 批量移入系统回收站

**FR-20 重命名** — 单文件重命名，同步索引与缩略图

**FR-21 移动** — 批量移动到目标分类目录

### 4.10 设置

全局设置保存在 `data/settings.json`（设置面板统一保存）：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `thumb_position` | 0.6 | 截图时间点比例 |
| `thumb_random_min` | 0.5 | 随机截图下限 |
| `thumb_random_max` | 0.8 | 随机截图上限 |
| `thumb_workers` | 3 | 缩略图并发数 |
| `thumb_idle_scan` | false | 后台全库补全 |
| `thumb_progress_bar` | auto | 缩略图进度条：auto / always / never |
| `default_page_size` | 32 | 每页条数（32 / auto / 自定义） |
| `potplayer_path` | 自动探测 | 外部播放器路径 |
| `player_mode` | html5 | 播放方式 |
| `history_retention_days` | 180 | 播放历史保留天数 |
| `hls_large_h264` | false | ≥300MB H.264 是否 HLS |
| `hls_moov_end_h264` | false | moov 在末尾的 H.264 是否 HLS |
| `html5_fragmented_mp4` | external | 碎片化 MP4：弹窗选 PotPlayer / 边切边播 |
| `html5_playlist_autoplay` | true | 播完自动下一集 |
| `html5_resume_playback` | true | 记忆播放位置（续播） |
| `html5_wheel_seek_sec` | 5 | 播放区滚轮快进/快退秒数（0=关闭） |
| `html5_modern_codecs_direct` | true | AV1/HEVC/VP9 等尝试浏览器直连 |
| `html5_player_prev_key` | `.` | 上一集快捷键 |
| `html5_player_next_key` | `/` | 下一集快捷键 |
| `ui_theme` | dark | 界面主题 dark / light |

未配置时从 `lib-default` 库内遗留设置回退；`potplayer_path` 空时自动探测本机安装路径。

**FR-27 服务重启** — 设置页触发 `POST /api/service/restart`；独立子进程执行 stop→start；前端用 `GET /api/health` 的 `boot_id` 两阶段确认新进程就绪。

### 4.11 实时更新

**FR-25 SSE 事件** — `GET /api/events` 推送版本与进度（含 `library_id`），前端防抖后增量刷新

**FR-26 新视频自动处理** — 文件变更 → 重扫 → 缩略图排队 + 播放策略探测

---

## 5. API 规格

### 5.1 页面与静态资源

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 主页面 |
| GET | `/static/*` | 静态资源 |

### 5.2 分类

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 分类列表 |
| POST | `/api/categories/star` | 设置星标 |
| POST | `/api/categories/reorder` | 更新自定义顺序 |
| POST | `/api/categories/sort-mode` | 切换排序模式 |

### 5.3 视频与目录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/folders` | 子目录树 |
| GET | `/api/videos` | 分页视频列表（支持 `favorites` / `history` / `album_id` / `format`） |
| GET | `/api/videos/{video_id}` | 单条视频详情 |
| GET | `/api/play/badges` | 当前页格式角标批量查询 |
| GET | `/api/durations` | 批量查询时长 |
| GET | `/api/duration/status` | 时长探测队列状态 |
| POST | `/api/duration/scan` | 触发时长补扫 |
| GET | `/api/format/status` | 格式索引状态 |
| POST | `/api/format/scan` | 触发格式索引扫描 |
| POST | `/api/rescan` | 强制重扫 |
| POST | `/api/videos/delete` | 批量删除 |
| POST | `/api/videos/rename` | 重命名 |
| POST | `/api/videos/move` | 批量移动 |

### 5.4 缩略图

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/thumb/status` | 队列状态 |
| GET | `/api/thumb/failed` | 失败列表 |
| GET | `/api/thumb/{video_id}` | 缩略图图片 |
| POST | `/api/thumb/priority` | 提升优先级 |
| POST | `/api/thumb/regenerate` | 重新生成 |
| POST | `/api/thumb/regenerate-failed` | 重试全部失败 |
| POST | `/api/thumb/pause` / `resume` | 暂停/恢复队列 |
| POST | `/api/thumb/cleanup` | 清理孤儿缓存 |

### 5.5 播放

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stream/{video_id}` | HTTP Range 小块流式直传（客户端断开即停读盘） |
| GET | `/api/play/info/{video_id}` | 播放策略 |
| POST | `/api/play/prepare/{video_id}` | 预切片 |
| GET | `/api/play/status/{video_id}` | 切片进度 |
| POST | `/api/play/stop` | 停止切片任务 |
| POST | `/api/play/pause` | 挂起当前 ffmpeg 切片进程 |
| POST | `/api/play/resume` | 恢复已挂起的切片进程 |
| GET | `/api/hls/{video_id}/{filename}` | HLS 分片 |
| POST | `/api/play-external/{video_id}` | 外部播放器 |
| POST | `/api/play/catchup/{video_id}` | 拖进度后强制续切 |
| POST | `/api/play/{video_id}` | 兼容旧版播放入口 |

### 5.5a 收藏

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/favorites/summary` | 收藏数量 |
| POST | `/api/favorites/toggle` | 切换收藏 |
| POST | `/api/favorites/batch` | 批量加入/移除（`action`: add / remove） |

### 5.5b 播放历史

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/history/record` | 记录播放（时间、次数） |
| POST | `/api/history/position` | 保存续播进度 `position_sec` |
| POST | `/api/history/clear` | 清空播放记录 |
| GET | `/api/history/summary` | 最近播放条数 |

视频列表 API 返回 `playPosition`、`playDuration`、`durationSec`、`formatBadge`、`albumIds` 等字段。

### 5.5c 我的专辑

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/albums` | 专辑列表（摘要：名称、封面、视频数） |
| POST | `/api/albums` | 新建专辑 |
| GET | `/api/albums/{album_id}` | 专辑详情（含 `video_ids`、`total_duration_sec`） |
| PATCH | `/api/albums/{album_id}` | 更新名称/描述/封面 |
| DELETE | `/api/albums/{album_id}` | 删除专辑 |
| POST | `/api/albums/reorder` | 专辑排序 |
| POST | `/api/albums/{album_id}/videos` | 添加视频 |
| POST | `/api/albums/{album_id}/videos/remove` | 移除视频 |
| POST | `/api/albums/{album_id}/videos/reorder` | 专辑内视频排序 |
| POST | `/api/albums/{album_id}/cover` | 设置封面视频 |

### 5.5d 修复（remux）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/videos/{video_id}/remux` | 单文件修复为标准 MP4 |
| GET | `/api/videos/{video_id}/remux` | 查询 remux 状态 |
| POST | `/api/remux/batch/begin` | 批量修复开始（暂停监视） |
| POST | `/api/remux/batch/end` | 批量修复结束（恢复监视） |

### 5.6 视频库

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/libraries` | 库列表与当前激活库 |
| POST | `/api/libraries` | 新增库（alias + path） |
| PATCH | `/api/libraries/{id}` | 更新别名或路径 |
| DELETE | `/api/libraries/{id}` | 删除注册（可选删除数据目录） |
| POST | `/api/libraries/{id}/activate` | 切换激活库 |
| POST | `/api/libraries/pick-folder` | Windows 文件夹选择器 |

上述接口及 5.2–5.5d 中多数 API 支持查询参数 `library_id`；省略时使用当前激活库。

### 5.7 设置、健康检查与事件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 读取设置（`?scope=global` 仅全局） |
| POST | `/api/settings` | 保存设置 |
| GET | `/api/health` | 健康检查（含 `boot_id`，供重启轮询） |
| POST | `/api/service/restart` | 触发服务重启 |
| GET | `/api/events` | SSE 事件流 |

---

## 6. 数据模型

### 6.1 VideoItem（API 响应字段节选）

```json
{
  "id": "md5(relative_path)",
  "path": "<绝对路径>",
  "filename": "example.mp4",
  "title": "提取的标题",
  "category": "分类名",
  "subfolder": "子目录/路径",
  "size": 1234567890,
  "mtime": 1710000000.0,
  "thumbReady": true,
  "thumbStatus": "ready",
  "favorited": false,
  "favoritedAt": null,
  "playedAt": null,
  "playCount": null,
  "playPosition": null,
  "playDuration": null,
  "durationSec": 3600.5,
  "formatBadge": "hls",
  "albumIds": ["alb-xxxxxxxxxxxx"]
}
```

### 6.2 Album（`albums.json` 摘要）

```json
{
  "id": "alb-xxxxxxxxxxxx",
  "name": "精选合集",
  "description": "",
  "cover_video_id": "<video_id 或 null>",
  "video_count": 12,
  "video_ids": ["vid1", "vid2"],
  "total_duration_sec": 43200.0
}
```

### 6.3 PlaybackPlan

```json
{
  "mode": "hls",
  "transcode": false,
  "input_format": "mpegts",
  "disguised": true,
  "reason": "PNG 头伪装 MPEG-TS",
  "cached": true
}
```

---

## 7. UI/UX 规范

- 默认深色主题（`ui_theme=dark`），可选白天模式（YouTube 浅色风格）
- 顶栏：首页 / 我的收藏 / 最近播放 / **我的专辑** / 视频库切换 / 搜索 / 批量 / 主题 / 设置 / 时长·缩略图状态芯片 / 刷新
- 侧栏固定宽度，分类列表可滚动，下方为子目录树（专辑列表视图下侧栏仍可见）
- 缩略图悬停：右上角 ♥ 收藏、左下 📁 专辑角标、右上勾选框；勾选不触发播放
- 播放器顶栏：收藏、加入专辑、上/下一集、PotPlayer；状态随 `favorited` / `albumIds` 即时更新
- 页面刷新采用增量 patch，避免整页闪烁；缩略图进度条可浮层显示（`thumb_progress_bar=auto`）

---

## 8. 运维与部署

### 8.1 启动

```powershell
python restart.py
```

### 8.2 日志

`data/logs/server.log`

### 8.3 配置

- 视频库：`src/loc_gallery/config.py` → `VIDEO_ROOT`
- 端口：默认 `3456`
- HLS 缓存上限：默认 5GB

---

## 9. 已知限制

1. 主要为 Windows 环境优化
2. 单用户本地，无认证，勿暴露公网
3. 伪装格式需按需扩展探测规则
4. 大库首次扫描缩略图/时长按需生成
5. 转码播放 CPU 占用较高
6. HLS 续播依赖已切片范围；边切边播时 seek 超前可能需等待
7. **专辑功能需运行含 `/api/albums` 的后端**；升级后须重启服务（`restart.py` 或设置页），否则前端报 Not Found
8. 专辑暂不支持导入/导出 JSON、侧栏专辑快捷入口

---

## 10. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | — | 基础画廊、外部播放器、缩略图队列 |
| **2.0.0** | **2026-07-19** | **多视频库、设置面板重构、播放列表排序与 HTML5 连播、PotPlayer 自动探测** |
| **2.1.0** | **2026-07-20** | **HTML5 续播、HLS 30 秒切片、暂停时挂起 ffmpeg、播放/切片 API 扩展** |
| **2.2.0** | **2026-07-20** | **默认 HTML5、碎片化 MP4 修复与角标、退出播放停读盘、播放策略 v13** |
| **3.0.0** | **2026-07-20** | **稳定版：小块流式 `/api/stream` 控读盘、续播/连播设置、播放页列表切换与连播修复** |
| **3.1.0** | **2026-07-20** | **顶栏导航与夜间主题、响应式网格、自适应/自定义分页、WMV 等走 HLS** |
| **3.2.0** | **2026-07-21** | **原生播放控件、智能标题截取、缩略图进度条、播放列表删除连播** |
| **3.3.0** | **2026-07-21** | **播放列表分页加载、滚轮快进设置、设置页紧凑布局** |
| **4.0.0** | **2026-07-21** | **稳定版：多段 mdat MP4 识别与 HLS 边切、切片水位控盘与拖进度 catchup** |
| **4.1.0** | **2026-07-22** | **碎片化 MP4 修复流程重写：改名 .bak 原地写出、保留时间戳与缩略图、播放不卡整站** |
| **4.2.0** | **2026-07-22** | **新下载自动入库、批量修复期间库级暂停监视并在批次结束后统一恢复** |
| **4.3.0** | **2026-07-23** | **连播降磁盘占用、播放列表缩略图原地刷新、缩略图进度条浮层** |
| **4.4.0** | **2026-07-24** | **启动加速读索引、格式筛选索引、白天模式、缩略图进度条与截图兜底** |
| **4.5.0** | **2026-07-25** | **播放快捷键与列表体验、缩略图时长、设置页重启服务与 Web 重启修复** |
| **4.6.0** | **2026-07-25** | **我的专辑：CRUD、多专辑归属、加入专辑/播放全部/本页生成专辑、封面与状态反馈** |

详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 11. 附录：伪装 MPEG-TS 格式说明

部分文件的物理特征：

- 扩展名可能为 `.mp4`，文件头为 **PNG 魔数**
- 偏移数百字节后为 **MPEG-TS** 流（H.264 + AAC）
- 非标准 MP4，亦非 H.264 裸流；ffmpeg 需 `-f mpegts` 才能正确解析

探测流程：`detect_disguised_mpegts()` → `input_format: mpegts` → HLS copy 切片 → hls.js 播放。
