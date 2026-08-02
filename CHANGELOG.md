# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
