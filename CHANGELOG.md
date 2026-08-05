# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
