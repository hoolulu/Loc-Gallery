# 01 — Loc Gallery 现有项目分析报告

> 源项目路径：`F:\Loc-Gallery`  
> 版本：8.1.0  
> 分析日期：2026-08-02  
> 最后同步：2026-08-02（8.1.0 小版本发布）

---

## 1. 产品定位

**Loc Gallery** 是一款面向 Windows 的**本地视频画廊 Web 服务**：

- 双击 `restart.py` 启动，浏览器访问 `http://127.0.0.1:3460`
- 扫描本地视频目录，自动生成缩略图网格
- 支持分类浏览、搜索、收藏、播放记录、专辑管理
- 内嵌 HTML5 / HLS 播放，必要时调用 PotPlayer 外部播放
- 无云依赖、无用户系统、仅本机运行

### 非目标（PRD 明确排除）

- 多用户 / 远程访问 / 权限体系
- 移动端 App
- 视频转码入库、TMDB 刮削
- 在线分享或公网部署

---

## 2. 技术栈现状

### 2.1 后端

| 组件 | 版本 | 文件 |
|------|------|------|
| Python | ≥3.11 | `pyproject.toml` |
| FastAPI | ≥0.115 | `requirements.txt` |
| uvicorn | ≥0.34 | 同上 |
| watchdog | ≥6.0 | 文件系统监听 |
| Pillow | ≥10.0 | 缩略图质量评估（仅 requirements.txt） |
| ffmpeg/ffprobe | 系统 PATH | 缩略图、HLS、格式探测 |

### 2.2 前端

| 组件 | 说明 |
|------|------|
| 原生 ES6+ | 无框架，单文件 `app.js`（~6503 行 IIFE） |
| Tailwind CSS 3.4 | 编译到 `static/tailwind.css` |
| 自定义 CSS | `static/style.css`（~3091 行） |
| hls.js | `static/vendor/hls.min.js` |
| 无构建链 | 无 bundler、无 TypeScript、无组件化 |

### 2.3 数据存储

**无传统数据库**。全部持久化为 JSON 文件 + 文件系统缓存：

```
data/
├── settings.json
├── libraries.json
└── libraries/{library_id}/
    ├── favorites.json
    ├── play_history.json
    ├── albums.json
    ├── category_meta.json
    ├── settings.json（可选，按库覆盖）
    ├── .thumbs/index.json
    └── cache/
        ├── hls/{video_id}/
        ├── playback_plans.json
        └── format_index.json
```

---

## 3. 项目结构

```
F:\Loc-Gallery\
├── restart.py                 # 一键重启入口
├── pyproject.toml
├── requirements.txt
├── package.json               # 仅 Tailwind 构建
├── tailwind.config.js
├── PRD.md                     # 产品需求文档
├── README.md
├── src/loc_gallery/           # Python 后端（24 模块）
│   ├── server.py              # ~1403 行，60+ 路由
│   ├── scanner.py             # 视频索引
│   ├── thumb_manager.py       # ~1584 行，缩略图队列
│   ├── media_probe.py         # 播放策略探测
│   ├── hls_manager.py         # HLS 切片缓存
│   ├── format_index.py        # 格式分类索引
│   ├── remux_manager.py       # MP4 remux 修复
│   ├── range_stream.py        # HTTP Range 流式直传
│   ├── file_stability.py      # 下载中文件稳定检测
│   ├── library_store.py       # 多视频库
│   ├── favorite_store.py      # 收藏
│   ├── history_store.py       # 播放历史
│   ├── album_store.py         # 专辑
│   ├── category_store.py      # 分类排序
│   ├── settings_store.py      # 设置
│   └── file_ops.py            # 文件操作
├── static/                    # 前端静态资源
│   ├── index.html             # ~634 行，所有视图
│   ├── app.js                 # ~6503 行，全部逻辑
│   ├── style.css              # ~3091 行
│   ├── tailwind.css
│   └── vendor/
├── scripts/                   # 启停、CSS 构建
├── config/settings.example.json
├── data/                      # 运行时数据（gitignored）
├── tests/                     # 6 个测试文件
└── docs/screenshots/
```

---

## 4. 核心功能清单

### 4.1 视频库管理

| 功能 | 说明 |
|------|------|
| 多库注册 | 添加/编辑/删除/切换多个本地根目录 |
| 库数据隔离 | 收藏、历史、专辑、缩略图、HLS 缓存按库隔离 |
| 文件夹选择器 | Windows 原生对话框选路径 |

### 4.2 画廊浏览

| 功能 | 说明 |
|------|------|
| 分类侧栏 | 一级子目录为分类，支持拖拽排序 |
| 子目录树 | 展开分类后显示文件夹树 |
| 视频网格 | 分页、搜索、多种排序（含随机列表，8.1.0） |
| 随机播放 | 工具栏按钮，从当前筛选范围随机选片播放（8.1.0） |
| 种子随机分页 | `seed` 确定性打乱，翻页不重复，持久化 localStorage（8.1.0） |
| 格式筛选 | 角标 + 格式索引筛选 |
| 面包屑导航 | 分类 > 子文件夹路径 |

### 4.3 缩略图系统

| 功能 | 说明 |
|------|------|
| 按需生成 | 当前页优先队列 |
| 后台补全 | 空闲时全库扫描 |
| 候选帧选择 | 12 张候选，手动/自动选最优 |
| 失败重试 | 失败列表 + 批量重试 |
| 进度显示 | 顶栏进度条 + SSE 实时更新 |
| 暂停/继续 | 队列控制 |

### 4.4 播放系统

| 功能 | 说明 |
|------|------|
| HTML5 直传 | 标准 H.264 小 MP4，256KB 分块 Range |
| HLS copy | 大文件 / moov 在末尾 / 伪装 TS |
| HLS 转码 | AV1/HEVC/VP9 → H.264 |
| PotPlayer | 外部播放器模式 |
| 断点续播 | 播放位置持久化 |
| 播放列表 | 排序（含随机）、自动连播、上一集/下一集 |
| HLS 切片节流 | 缓冲控制、seek 追切片 |
| Remux 修复 | 碎片化 H.264 MP4 一键修复 |

### 4.5 收藏与历史

| 功能 | 说明 |
|------|------|
| 收藏切换 | 卡片/播放器内 ♥ 按钮 |
| 批量收藏 | 批量管理栏 |
| 播放记录 | 播放次数、时间、位置 |
| 历史视图 | 按播放时间倒序 |
| 外部删文件 | 自动 prune 无效记录 |

### 4.6 专辑系统

| 功能 | 说明 |
|------|------|
| 专辑 CRUD | 新建/编辑/删除 |
| 视频归属 | 多对多，一视频可多专辑 |
| 专辑封面 | 默认首条缩略图，可指定 |
| 播放全部 | 专辑内顺序播放 |
| 专辑详情 | 网格浏览专辑内视频 |

### 4.7 文件管理

| 功能 | 说明 |
|------|------|
| 删除 | 进 Windows 回收站 |
| 重命名 | 视频/文件夹 |
| 移动 | 视频/文件夹跨分类 |
| 打开文件夹 | 资源管理器定位 |
| 批量操作 | 多选后批量删除/移动/收藏/修复 |

### 4.8 分类管理

| 功能 | 说明 |
|------|------|
| 拖拽排序 | 自定义分类顺序 |
| 排序模式 | custom / name_asc / name_desc / count_desc / count_asc |
| 文件夹操作 | 删除/重命名/移动子文件夹 |

### 4.9 设置系统

| 功能 | 说明 |
|------|------|
| 全局/按库设置 | scope: global / library |
| 播放器配置 | 模式、快捷键、续播、连播 |
| 缩略图配置 | 位置、并发、候选数、自动选优 |
| 主题切换 | dark / light |
| 服务重启 | 不退出程序重启后端 |

### 4.10 实时同步

| 功能 | 说明 |
|------|------|
| 文件监听 | watchdog 检测新增/删除/修改 |
| SSE 推送 | 索引版本变更 + 缩略图进度 |
| 稳定检测 | 下载中文件等待稳定后再索引 |

---

### 4.11 8.1.0 小版本新增（2026-08-02）

> 源项目已发布 8.1.0，以下为相对 7.0.0 调研时的新增功能，Vue 重构需一并移植。

| 功能 | 说明 | 源位置 |
|------|------|--------|
| 随机列表排序 | 排序下拉新增「随机列表」，`sort=random` + `seed` 参数 | `index.html` L122, `app.js` L6453 |
| 随机播放按钮 | 工具栏「随机播放」，从当前筛选范围随机选 1 个视频 | `index.html` L147, `app.js` L6480 |
| 播放列表随机 | 播放器右侧列表排序新增「随机」 | `index.html` L212, `app.js` L6766 |
| 种子持久化 | `randomSeed` / `playlistRandomSeed` 写入 localStorage，筛选变化时重新生成 | `app.js` L228, L378, L396 |
| 随机播放联动 | 点击随机播放后播放列表自动切为随机排序，连播按随机顺序 | `app.js` L6486-6500 |

---

## 5. 视图模式

| viewMode | 说明 | URL 参数 |
|----------|------|----------|
| `browse` | 浏览首页/分类/文件夹 | 默认 |
| `favorites` | 我的收藏 | `?view=favorites` |
| `history` | 最近播放 | `?view=history` |
| `albums` | 专辑列表 | `?view=albums` |
| `album-detail` | 专辑详情 | `?view=album&album_id=` |

---

## 6. UI 组件清单

### 6.1 对话框

| ID | 用途 |
|----|------|
| `settings-dialog` | 设置（库/播放/缩略图/其他） |
| `rename-dialog` | 视频重命名 |
| `move-dialog` | 视频移动到分类 |
| `move-folder-dialog` | 文件夹移动 |
| `album-form-dialog` | 新建/编辑专辑 |
| `album-picker-dialog` | 选择加入的专辑 |
| `thumb-picker-dialog` | 手动选缩略图候选 |
| `nonstandard-dialog` | 非标准 MP4 处理 |
| `failed-dialog` | 缩略图失败列表 |
| `play-overlay` | 播放加载/修复进度 |

### 6.2 右键菜单

| ID | 用途 |
|----|------|
| `ctx-menu` | 视频右键 |
| `album-ctx-menu` | 专辑右键 |
| `folder-ctx-menu` | 文件夹/分类右键 |

### 6.3 顶栏元素

- Logo、视图切换（首页/收藏/历史/专辑）
- 库切换下拉
- 搜索框
- 批量按钮
- 主题切换
- 设置按钮
- 时长探测芯片
- 缩略图状态芯片
- 刷新按钮
- 缩略图进度条（可展开）

---

## 7. 键盘快捷键

| 按键 | 条件 | 行为 |
|------|------|------|
| `Escape` | 播放遮罩可见 | 取消播放 |
| `.` | 播放器打开 | 上一集 |
| `/` | 播放器打开 | 下一集 |
| `/` | 非搜索框 | 聚焦搜索 |
| `←` / `→` | 非输入框 | 上一页 / 下一页 |
| `Escape` | 搜索框 | 清空搜索 |
| 滚轮 | 播放器内 | ±5 秒快进/快退 |

---

## 8. 设置键完整列表

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `thumb_position` | float | 0.6 | 截图时间点比例 |
| `thumb_random_min` | float | — | 随机截图下限 |
| `thumb_random_max` | float | — | 随机截图上限 |
| `thumb_workers` | int | 3 | 缩略图并发 |
| `thumb_idle_scan` | bool | false | 空闲全库补缩略图 |
| `thumb_progress_bar` | string | auto | 进度条显示策略 |
| `thumb_candidate_count` | int | 6 | 候选图数量 |
| `thumb_auto_select_best` | bool | false | 单选自动选优 |
| `thumb_batch_auto_select` | bool | true | 批量自动选优 |
| `thumb_jitter_pct` | int | 10 | 随机偏移 ±% |
| `thumb_jitter_min` | int | 6 | 偏移下限 % |
| `thumb_jitter_max` | int | 94 | 偏移上限 % |
| `default_page_size` | int | 40 | 默认每页条数 |
| `potplayer_path` | string | "" | PotPlayer 路径 |
| `player_mode` | string | html5 | html5 / potplayer / smart |
| `history_retention_days` | int | 180 | 历史保留天数 |
| `hls_large_h264` | bool | false | 大 H.264 走 HLS |
| `hls_moov_end_h264` | bool | false | moov 末尾走 HLS |
| `html5_fragmented_mp4` | string | external | 碎片化 MP4 策略 |
| `html5_playlist_autoplay` | bool | true | 播放列表连播 |
| `html5_resume_playback` | bool | true | 断点续播 |
| `html5_wheel_seek_sec` | int | 5 | 滚轮快进秒数 |
| `html5_modern_codecs_direct` | bool | true | 现代编码直连 |
| `html5_player_prev_key` | string | . | 上一集快捷键 |
| `html5_player_next_key` | string | / | 下一集快捷键 |
| `ui_theme` | string | dark | dark / light |

---

## 9. 技术债与痛点

### 9.1 架构层面（高优先级）

| 问题 | 详情 | 影响 |
|------|------|------|
| 前端单体巨石 | `app.js` ~6503 行、~272 函数 | 无法维护、无法测试 |
| 后端路由巨石 | `server.py` ~1403 行、60+ 路由 | 职责不清 |
| 缩略图管理器过重 | `thumb_manager.py` ~1584 行 | 难以修改 |
| 无前端构建链 | 无 bundler/TS/组件化 | 无法现代化 |
| 样式双轨 | Tailwind + 3091 行手写 CSS | 维护成本高 |

### 9.2 数据与状态

| 问题 | 详情 |
|------|------|
| JSON 文件存储 | 无事务、大库全量读写 |
| 内存索引 | 重启需重扫 |
| 配置三处重复 | config.py / settings_store / settings.example.json |

### 9.3 平台耦合

| 问题 | 详情 |
|------|------|
| Windows 强绑定 | taskkill、文件夹选择器、回收站 |
| 硬编码路径 | `VIDEO_ROOT = Path(r"F:\AVV")` |

### 9.4 测试覆盖

| 问题 | 详情 |
|------|------|
| 仅 6 个测试文件 | 无前端测试、无 E2E |
| 无 CI 配置 | 无自动化流水线 |

---

## 10. 可保留的设计

以下后端设计成熟稳定，重构时应**原样保留**：

1. 按库隔离的数据目录结构
2. `contextvars` 库上下文模式
3. 播放策略探测 + HLS 缓存 LRU
4. SSE 实时推送
5. 文件稳定性检测
6. 缩略图队列与候选帧机制
7. Remux 流复制修复

---

## 11. 关键文件体量

| 文件 | 行数 | 重构策略 |
|------|------|----------|
| `static/app.js` | ~6503 | **完全重写**为 Vue 组件 |
| `static/style.css` | ~3091 | **替换**为 Tailwind + CSS Variables |
| `static/index.html` | ~634 | **拆分**为 Vue 单文件组件 |
| `server.py` | ~1403 | **拆分**为 Router 模块 |
| `thumb_manager.py` | ~1584 | 保留，可选子模块拆分 |
| `media_probe.py` | ~720 | 保留 |
| `hls_manager.py` | ~648 | 保留 |

---

## 12. 测试现状

| 文件 | 覆盖 |
|------|------|
| `test_album_store.py` | 专辑存储 |
| `test_album_api.py` | 专辑 API |
| `test_multi_library.py` | 多库隔离 |
| `test_disguised_pipe.py` | 伪装 TS 格式 |
| `test_auto_new_video.py` | 新视频自动索引 |
| `test_file_stability.py` | 文件稳定检测 |

**缺失**：前端测试、播放器 E2E、设置页、批量操作、SSE 集成测试。
