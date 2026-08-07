# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [11.0.0] - 2026-08-07

### 重大变更

- **播放器内核升级**：全面切换为 movi-player `<movi-player>` web 组件（canvas 渲染 + 完整控件 + Shadow DOM 字幕渲染），直连流 + WASM 解码，替代早期 HLS `<video>` 播放路径
- **播放器架构重构**：`useMoviPlayer` 命令式集成，以 `statechange` 状态机驱动就绪 / 播放 / 错误处理；续播、字幕自动选中文等由封装层统一管理
- **快捷键策略调整**：新增「播放器内置快捷键」开关并**默认关闭**——键位完全交由页面级脚本（如油猴 HTML5 增强）接管，消除按键冲突

### 新增

- 设置项「播放器内置快捷键」（`html5_disable_movi_hotkeys`），可随时切回播放器接管
- 右键菜单「复制文件路径」（列表页与播放页右侧播放列表均可用）
- `/api/stream` 支持 HEAD 请求（movi-player HttpSource 探测文件大小 / Range 支持）

### 修复

- **播放器永久卡"加载中"**：movi-player 构造函数违规设置 `tabindex` 属性，导致 `document.createElement('movi-player')` 抛 `NotSupportedError`（部分 Chromium 静默返回不可用元素）→ 创建时校验产物并回退 `new MoviElement()`；同步修复 `src` 须在挂载前设置、就绪信号改用 `statechange` 等
- **特定站点源无法播放**：多段 mdat / 碎片化 MP4（如 123AV「Uncensored Leaked」HLS 转存）的 moov 无法被 movi-player 解析 → `remuxable` 文件播放前自动重封装修复，12 秒兜底自动触发
- **滚轮快进 / 回退失效**：恢复画面区滚轮绑定（步长由 `html5_wheel_seek_sec` 控制，0 关闭）
- **重命名双重扩展名**：输入带 `.mp4` 的完整文件名会生成 `xxx.mp4.mp4` → 后端智能去重、前端按去扩展名的 stem 传参
- **续播提示**：左下角"从 X 继续播放"提示 3 秒后自动消失

### 移除

- 播放器工具栏音轨 / 字幕下拉框（由 movi-player 齿轮菜单接管）
- 旧 HLS `<video>` 播放路径（startHls / waitHlsReady / startWebHls / bindSaver 等）

---

## [10.0.2] - 2026-08-05

### 修复

- **缩略图接口 404**：`/api/thumb/{video_id}` 在缩略图文件不存在时返回 500 而非 404（文件被清理 / 外部删除 / 生成失败时会触发），现改为返回 404
- **播放修复卡死**：`remux_manager` worker 在清理旧临时文件时若抛出 `OSError`（文件被残留进程占用），会让该视频的修复任务永久停在排队状态、无法重试；现忽略该清理错误
- **重封装后排序错乱**：`refresh_video_item_stat` 更新 size/mtime 后未失效按大小 / 时间排序的全局索引，导致 remux 原地替换后列表顺序错误
- **误删收藏/历史/专辑风险**：库索引因瞬时状态（文件处于 20 秒写入窗口等）暂时为空时，清理逻辑会按空集合误删全部收藏、播放历史与专辑；现为空索引时跳过清理
- **格式扫描进度重复计数**：`get_format_status` 的 `scanning` 统计把排队项重复计入，导致进度高估一倍

### 测试

- 新增回归测试：`test_thumb_404.py`、`test_scanner_invalidate.py`、`test_prune_guard.py`
- 修复 `test_auto_new_video.py`（旧模块 `avv_gallery`、旧端口、多库适配）与 `test_multi_library.py`（调用已不存在的 `update_position`）

---

## [10.0.1] - 2026-08-04

### 改进

- 右键菜单自适应视口位置，播放列表等窄区域不再显示不全
- 播放器「上一个 / 下一个」移至左侧工具栏「返回浏览」右侧
- 视频聚焦时去除白框描边

---

## [10.0.0] - 2026-08-02

### 重大变更

- **架构重构**：前端由原生 HTML/JS 全面迁移至 **Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4**
- **开发体验**：单端口 `3460` 开发模式（Vite 热更新 + 内部 API），`python restart.py` 一键启动
- **默认端口**：由 `3456` 调整为 **`3460`**
- **项目结构**：`frontend/` + `backend/src/loc_gallery/` 前后端分离

### 新增

- 经典 / 影院两种布局预设，暗色 / 亮色主题
- 虚拟滚动网格、列表 API 批量加载与资源缓存
- `scripts/setup.py` 首次依赖安装；`scripts/clean_cache.py` 清理 HLS 与日志缓存
- 启动时 HLS 缓存 LRU 淘汰（单库上限 2GB）
- 产品文档 `doc/PRD.md`

### 改进

- 播放策略探测与格式角标逻辑优化（直连/HLS 不转码不再显示「转码」角标）
- 播放器导航、随机列表、批量操作栏与右键菜单体验打磨
- `.gitignore` 强化，避免误提交 `data/`、日志、PID 等运行时文件

### 升级说明（从 8.x）

1. 拉取本版本代码后执行 `python scripts/setup.py`（或首次 `python restart.py` 会自动安装依赖）
2. **用户数据兼容**：`data/libraries/{id}/` 下的 `.thumbs/`、`favorites.json`、`play_history.json`、`albums.json`、`category_meta.json` 可保留
3. 可安全清理：`data/**/cache/hls/`、`data/logs/`（会按需重建）
4. 在 **设置 → 视频库** 中确认库路径后点击顶栏 **刷新** 完成索引

### 环境要求

- Python 3.10+
- Node.js 18+（开发 / 构建前端）
- ffmpeg / ffprobe（PATH 可用）

---

## [8.1.0] 及更早版本

历史记录见 Git 提交与 [GitHub Releases](https://github.com/hoolulu/Loc-Gallery/releases)。
