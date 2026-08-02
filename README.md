# Loc Gallery

**本地视频画廊 Web 服务** — 在浏览器中浏览、搜索、播放本机视频，支持收藏、历史、专辑与智能播放策略。

> **当前版本：10.0.0** · Vue 3 架构重构大版本  
> 默认访问：**http://127.0.0.1:3460**

---

## 快速开始

### 首次安装

```powershell
# 1. 克隆仓库
git clone https://github.com/hoolulu/Loc-Gallery.git
cd Loc-Gallery

# 2. 安装依赖（也可跳过，restart.py 首次运行会自动安装）
python scripts/setup.py

# 3. 启动（开发模式，支持前端热更新）
python restart.py
```

浏览器会自动打开。首次使用请在 **设置 → 视频库** 中添加本地文件夹路径，然后点击顶栏 **刷新** 完成扫描。

### 日常启动

| 命令 | 说明 |
|------|------|
| `python restart.py` | 开发模式：单端口 3460，Vite 热更新 |
| `python restart.py --build` | 生产模式：构建 `frontend/dist` 后由后端托管 |
| `python restart.py --no-setup` | 跳过自动依赖检查/安装 |

### 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| Python | 3.10+ | 后端 API、启动脚本 |
| Node.js | 18+ | 前端开发 / 构建（`npm`） |
| ffmpeg / ffprobe | 任意较新版本 | 缩略图、HLS、转码、时长探测 |

将 ffmpeg 加入系统 **PATH**。Windows 可从 [ffmpeg 官网](https://ffmpeg.org/download.html) 或 `winget install ffmpeg` 安装。

---

## 从 8.x 升级

1. 拉取 **10.0.0** 代码（Git 历史保留，工作区为全新 Vue 架构）
2. 执行 `python scripts/setup.py` 安装新依赖
3. **保留** `data/libraries/{库ID}/` 下：`.thumbs/`、`favorites.json`、`play_history.json`、`albums.json`、`category_meta.json`
4. **可清理**（按需重建）：`data/**/cache/hls/`、`data/logs/` — 也可运行 `python scripts/clean_cache.py`
5. 用 `python restart.py` 启动，在设置中确认视频库路径后刷新索引

详细变更见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 主要功能

- 多视频库、分类与子文件夹浏览，搜索 / 排序 / 格式筛选
- 经典 / 影院布局，暗色 / 亮色主题
- HTML5 播放器：续播、连播、播放列表、HLS / 转码 / 直连自动选择
- 收藏、播放历史、专辑管理
- 缩略图后台生成、候选挑选、批量操作
- 批量管理、右键菜单、文件夹与文件操作
- SSE 实时进度、文件监听自动索引

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Tailwind CSS 4 |
| 后端 | FastAPI · uvicorn |
| 播放 | HTML5 Video · hls.js · ffmpeg |

---

## 项目结构

```
Loc-Gallery/
├── frontend/          # Vue 3 前端
├── backend/           # FastAPI 后端 (loc_gallery)
│   └── requirements.txt
├── data/              # 索引、缩略图、设置（运行时生成，不提交 Git）
├── scripts/           # setup.py、clean_cache.py、服务管理
├── restart.py         # 一键启动入口
├── doc/PRD.md         # 产品需求文档
└── CHANGELOG.md       # 版本更新记录
```

---

## 文档

- [产品需求文档（PRD）](./doc/PRD.md) — 功能范围、架构、播放策略、设置项
- [更新日志](./CHANGELOG.md)

---

## 开发与维护

```powershell
# 仅启动后端 API（调试用）
python dev_backend.py

# 前端单独开发（需另起后端或代理）
cd frontend
npm run dev

# 清理 HLS 缓存与 data/logs（不删缩略图与用户 JSON）
python scripts/clean_cache.py
```

---

## 许可证

见仓库根目录 LICENSE（如有）。
