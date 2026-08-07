## 八、安装与配置

### 🧠 方式一：AI 傻瓜安装（推荐）

把下面这段提示词复制到 **Cursor / OpenCode / Claude Code** 等 AI 聊天框发送，AI 会自动完成安装与配置：

```text
请调研 https://github.com/hoolulu/Loc-Gallery 项目（当前主分支为 11.0.1），按照 README 依次完成本机安装：

1. 克隆仓库到合适目录（Windows）
2. 确认 Python 3.10+ 可用；执行 python scripts/setup.py 安装依赖（或运行 python restart.py，首次会自动安装）
3. 确认 Node.js 18+ 与 npm 可用（开发模式需要；不可用则协助安装）
4. 确认 ffmpeg 与 ffprobe 在 PATH 中可用（不可用则协助安装，如 winget install ffmpeg）
5. 询问我的视频库根目录路径，在启动后的「设置 → 视频库」中添加该路径（勿将真实路径写入代码或提交 Git）
6. 运行 python restart.py 启动服务，确认 http://127.0.0.1:3460 可访问
7. 在设置中保存后点击顶栏「刷新」完成首次扫描
8. 简要说明如何日常使用（重启、设置页、收藏与最近播放、经典/影院布局切换）

每完成一步都确认结果，最后总结安装状态与访问地址。不要提交或上传 data/ 目录中的任何文件。
```

AI 会读取项目文档 → 检测本机环境 → 逐项安装配置 → 启动验证。你只需提供**视频库路径**即可。

### 🔧 方式二：手动安装

手动安装步骤见下方 **[十三、FAQ → 如何手动安装？](#如何手动安装)**。

### 前置依赖

| 组件 | 必须 | 说明 |
|------|:----:|------|
| **Windows 10/11** | ✅ | 主要开发与运行环境 |
| **Python 3.10+** | ✅ | 运行 FastAPI 后端 |
| **ffmpeg / ffprobe** | ✅ | 缩略图、重封装与播放探测；需在 PATH 中 |
| **Node.js 18+** | ⚠️ | 开发模式与 `restart.py --build` 时需要；首次 `restart.py` 可自动安装 npm 依赖 |

> **提示：** 服务绑定 `127.0.0.1:3460`，设计为本机使用。PotPlayer 等外部播放器路径请在启动后的**设置页**配置，勿写入公开仓库。

## 九、用 AI 提示词更新项目

本项目从架构到功能均可由 AI 协作开发（前端 Vue 3 / 后端 FastAPI 双端）。把下面这段**交接提示词**发给 AI 助手，即可快速接管项目进行更新：

````markdown
【交接】Loc Gallery —— 本地视频画廊 Web 服务（私有、单用户、Windows 优先）

技术栈：
- 前端：Vue 3 + TS + Vite + Pinia + Tailwind CSS 4（frontend/），播放器为 movi-player web 组件
- 后端：FastAPI + uvicorn（backend/src/loc_gallery/），ffmpeg/ffprobe 为媒体引擎
- 启动：`python restart.py` 开发单端口 3460（Vite 热更新，/api 代理到 3461）；默认访问 http://127.0.0.1:3460
- 生产构建：`python restart.py --build`（用户日常用 dev 模式，体验一致）

关键链路：
- 扫描索引(watchdog+稳定检测) → 缩略图队列(thumb_manager) → 播放策略探测(media_probe 写 playback_plans)
- 播放：movi-player 直连 /api/stream Range 流（WASM demux）；碎片化/多段 mdat 文件播放前自动重封装(remux_manager)
- 后台批量预修复：html5_auto_remux 默认开，空闲时自动重封装可修复文件
- 数据按库隔离：data/libraries/{id}/（favorites/history/albums/category_meta/settings/.thumbs）

注意事项：
- 不要在生产构建上纠结：dev 模式（restart.py）即可，构建验证可跳过
- 后端改了设置/模块后需要用户手动重启（restart.py）才生效；前端 composables 改动硬刷(Ctrl+Shift+R)即可
- 服务无认证，仅 127.0.0.1 本机
- data/、.workbuddy/ 全部 gitignored，勿提交
````

**常用提示词示例：**

| 想做什么 | 提示词 |
|----------|--------|
| 修一个 bug | 「播放器点击后卡加载，F12 报 XXX，定位根因并修复，说明改动文件」 |
| 加小功能 | 「在右键菜单加「导出列表」：把当前筛选结果导出为 txt 路径清单」 |
| 调样式 | 「卡片悬停预览浮层整体再大 10%，保持视口约束」 |
| 发新版本 | 「发布 11.0.x：更新 VERSION/package/CHANGELOG/README，提交 git」 |
| 全量检查 | 「全系统审计：端点匹配、import 完整性、死代码、文档同步，给出报告」 |

> 💡 提示词要点：给出**技术栈 + 启动方式 + 关键链路 + 注意事项**即可，AI 会自己读代码定位。改完代码务必让 AI 跑 `vue-tsc` 与 `py_compile` 验证，涉及后端再重启服务。

## 十、使用方法

### 多视频库

- 顶栏 **选择视频库** 下拉切换；URL 支持 `?lib=` 参数
- **设置 → 视频库**：管理现有库（别名、路径）、添加新库（别名 + 路径 + 浏览）
- 收藏、历史、缩略图、分类元数据按库隔离；播放/缩略图等支持全局与单库设置

### 播放页与连播

- 播放页右侧**播放列表**可按文件名（自然排序）、标题、时间、大小等排序
- 设置中可开关 **播完自动下一集**、**记忆播放位置（续播）**
- **续播**：进度写入 `play_history.json`；再次打开从上次位置继续（≥15 秒且距结尾 ≥45 秒）
- **movi-player 内嵌播放**：`/api/stream` Range 直连 + WASM demux；画面右下角齿轮菜单可切换音轨/字幕
- **异常文件自动修复**：碎片化 / 多段 mdat 播放前自动重封装（可后台批量预修复，设置「后台自动修复」）
- 追剧建议：筛选到目标文件夹后，每页选「全部」，列表排序选「文件名 A→Z（自然）」

### 日常浏览

1. 启动服务后，左侧选择**分类**，下方可展开**子目录树**
2. 顶栏**搜索框**支持标题、文件名、分类关键词
3. 点击卡片**播放**；悬停卡片可**多段视频预览**（默认开，可调段数/时长）；悬停 ♥ 收藏、📁 管理专辑
4. **♥ 我的收藏** / **⏱ 最近播放** / **📁 我的专辑** 切换顶栏视图
5. 格式下拉可筛「无法播放」（浏览器硬解不支持的编码）；播放时自动修复或提示用外部播放器
6. 顶栏可切换**经典 / 影院**布局与**暗色 / 亮色**主题

### 我的专辑

- 顶栏 **📁 我的专辑**：新建、编辑、删除专辑；点击进入专辑详情
- **加入专辑**：右键菜单、批量栏、播放器按钮；勾选对话框支持新建并加入
- **本页生成专辑**：浏览页工具栏，将当前页视频一次性加入新专辑
- 专辑详情：**播放全部**、视频数/总时长、右键「设为专辑封面」
- 数据按库隔离：`data/libraries/{id}/albums.json`；删视频自动从专辑移除

### 缩略图队列

- 顶栏进度条显示全库 / 当前页 / 队列状态
- 默认**仅按需生成当前浏览页**；可在设置中开启「后台补全全库」
- 可暂停队列、重试失败项、挑选候选帧

### 播放器

播放统一走 **movi-player 内嵌播放器**（浏览器 WASM demux + 硬解直连）。无法硬解的编码（mpeg2/VC-1/WMV 等）播放时弹窗提示，可一键**用外部播放器打开**（设置「外部播放器路径」，默认自动探测 PotPlayer）。

播放策略自动缓存，常见场景：

| 场景 | 策略 |
|------|------|
| 标准 H.264 / H.265 / AV1 / VP9 MP4 | 直连 `/api/stream`（WASM demux） |
| 碎片化 / 多段 mdat MP4 | 播放前自动重封装（`html5_auto_remux` 可后台预修复） |
| PNG 头 + MPEG-TS 伪装 | 直连（movi-player 的 demuxer 支持 TS） |
| 非 MP4 容器（MKV 等） | 尝试直连；失败提示外部播放器 |
| mpeg2 / VC-1 / WMV 等硬解不支持 | 提示用外部播放器打开 |

### 文件管理

「批量」模式下可多选，执行删除（回收站）、移动、批量收藏、加入专辑、修复 MP4。

## 十一、设置项（全局）

在设置面板中统一保存至 `data/settings.json`（完整列表见 [doc/PRD.md](./doc/PRD.md)）：

| 键 | 默认值 | 说明 |
|----|--------|------|
| `thumb_position` | 0.6 | 截图时间点（时长比例） |
| `thumb_random_min` / `max` | 0.5 / 0.8 | 随机截图范围 |
| `thumb_workers` | 3 | 缩略图并发数（修改后需重启服务） |
| `thumb_idle_scan` | false | 后台补全全库缩略图 |
| `thumb_progress_bar` | auto | 缩略图进度条显示模式 |
| `default_page_size` | 32 | 每页条数（支持自适应） |
| `ui_theme` | dark | 界面主题 dark / light |
| `html5_playlist_autoplay` | true | 播完是否按列表连播下一集 |
| `html5_resume_playback` | true | 是否记忆播放位置并续播 |
| `html5_wheel_seek_sec` | 5 | 播放区滚轮快进/快退（0=关闭） |
| `html5_player_prev_key` / `next_key` | `.` / `/` | 上/下一集快捷键 |
| `html5_disable_movi_hotkeys` | true | 关闭 movi-player 内置快捷键（避免与油猴脚本冲突） |
| `html5_hover_preview` | true | 悬停卡片多段视频预览（可调段数/每段秒数） |
| `html5_auto_remux` | true | 后台空闲时自动批量重封装可修复文件 |
| `external_player_path` | （自动探测） | 外部播放器路径（VLC / MPC-HC / PotPlayer 等） |
| `history_retention_days` | 180 | 播放历史保留天数 |

## 十二、开发

```powershell
cd <项目根目录>

# 开发模式（推荐日常）：单端口 3460，Vite 热更新
python restart.py

# 仅后端 API
python dev_backend.py

# 前端单独开发（需另起后端）
cd frontend
npm run dev

# 生产构建
cd frontend
npm run build
# 或
python restart.py --build
```

### 测试

```powershell
cd <项目根目录>
$env:PYTHONPATH = "<项目根目录>\backend\src"
python -m pytest backend/tests/test_file_stability.py -v
python -m unittest backend.tests.test_album_store backend.tests.test_album_api backend.tests.test_multi_library -v
# 部分测试需先启动服务
python backend/tests/test_auto_new_video.py
```

## 十三、隐私与分享

本项目设计为**纯本地、单用户**使用。分享代码或打包给他人时，请注意：

| 可分享 | 勿分享（含个人隐私） |
|--------|----------------------|
| `frontend/`、`backend/`、`scripts/` | 整个 `data/` 目录 |
| `config/settings.example.json` | `data/settings.json` |
| `README.md`、`doc/PRD.md`、`CHANGELOG.md` | `data/libraries.json`、`data/libraries/` |
| `doc/`（含 `screenshots/`） | `data/logs/`、`.server.pid`、`.vite.pid` |

**源码中不应出现：**

- Windows 用户名（如 `C:\Users\...`）
- 本机软件安装路径（PotPlayer 等请在设置里配置，不要写进 `config.py`）
- 真实视频文件名（测试脚本通过环境变量传入样本）

**视频库路径** 请在**设置 → 视频库**中配置，勿提交到 Git。`config.py` 中的 `VIDEO_ROOT` 仅作本地开发种子，对方克隆后应改成自己的路径或直接在设置页添加。

`.gitignore` 已默认忽略 `data/` 与日志、PID 文件。若初始化 Git 仓库，请勿将上述运行时文件加入版本库。

## 十四、FAQ

### 如何手动安装？

```powershell
# 1. 克隆
git clone https://github.com/hoolulu/Loc-Gallery.git
cd Loc-Gallery

# 2. Python 依赖
pip install -r backend/requirements.txt

# 3. 前端依赖（开发模式 / --build 需要）
cd frontend
npm install
cd ..

# 4. 启动
python restart.py
```

浏览器将自动打开 `http://127.0.0.1:3460`。在 **设置 → 视频库** 中添加路径后点击顶栏 **刷新**。

可选：将 `config/settings.example.json` 复制为 `data/settings.json` 后按需修改。

### 从旧版本升级要注意什么？

1. 拉取最新 `master`（Git 历史保留，代码为 Vue 3 全新架构）
2. 执行 `python scripts/setup.py` 或 `python restart.py`（自动装依赖）
3. **保留** `data/libraries/{库ID}/` 下：`.thumbs/`、`favorites.json`、`play_history.json`、`albums.json`、`category_meta.json`
4. **可清理**：`data/logs/` 与旧版遗留的 HLS 缓存（运行 `python scripts/clean_cache.py`）
5. 默认端口由 **3456** 改为 **3460**
6. 详细变更见 [CHANGELOG.md](./CHANGELOG.md)

**1. 视频库放哪？项目放哪？**

- **视频库**：在设置 → 视频库管理中配置（支持 Windows 文件夹选择器）
- **项目**：任意目录均可；扫描时会自动忽略 `Loc-Gallery` / `loc-gallery` 等项目自身目录名

**2. 下载中的视频为什么之前会显示缩略图失败？**

文件仍在写入时 size/mtime 持续变化，ffmpeg 抽帧会失败。现在会等文件稳定后再索引和生成缩略图；已误标的失败状态会自动重置。

**3. 外部删除了视频，收藏和历史还在吗？**

不会。文件删除触发库刷新后，会自动从当前库的 `favorites.json`、`play_history.json` 与 `albums.json` 中移除对应条目。

**4. 点击「我的专辑」报 Not Found？**

说明后端仍是旧进程。运行 `restart.py` 或在设置页「重启服务」，并 Ctrl+F5 强刷页面。

**5. 多个视频库的数据存在哪？**

`data/libraries.json` 登记库列表；每库数据在 `data/libraries/{library_id}/`（收藏、历史、**专辑**、缩略图等）。全局设置在 `data/settings.json`。

**6. 能暴露到局域网或公网吗？**

不建议。服务无认证，设计为 `127.0.0.1` 本机使用。若改 `HOST` 请自行评估风险。

**7. 伪装 MPEG-TS 是什么？**

部分文件扩展名为 `.mp4`，文件头却是 PNG 魔数，偏移后为 MPEG-TS 流。movi-player 的 WASM demuxer 可直接解析，无需切片。

**8. 无法播放的视频怎么办？**

浏览器硬解不支持的编码（mpeg2/VC-1/WMV 等）播放时会弹窗提示，可用**外部播放器打开**（设置「外部播放器路径」，默认自动探测 PotPlayer）。碎片化 / 多段 mdat 文件会自动重封装修复，无需手动处理。

**9. 续播进度存在哪？**

`data/libraries/{library_id}/play_history.json` 的 `position_sec` 字段；movi-player 直连播放与自动修复后均支持。

**10. `restart.py` 和 `restart.py --build` 有什么区别？**

- `restart.py`：开发模式，Vite 在 3460 端口提供热更新，适合日常使用和改前端
- `restart.py --build`：先 `npm run build`，再由后端在 3460 托管 `frontend/dist`，适合不需要改前端的稳定运行

## 十五、日志与排错

| 路径 | 内容 |
|------|------|
| `data/logs/server.log` 或 `logs/server.log` | 服务运行日志 |
| `logs/vite.log` | Vite 开发服日志（仅开发模式） |
| `.server.pid` | 当前后端进程 PID |
| `.vite.pid` | 当前 Vite 进程 PID（仅开发模式） |

常见问题：

- **端口 3460 被占用** → 再运行一次 `restart.py`（会先停旧进程）
- **提示未找到 Vite** → 在 `frontend` 目录执行 `npm install`，或运行 `python scripts/setup.py`
- **缩略图全失败** → 检查 `ffmpeg -version` 是否在 PATH 中
- **播放黑屏/卡加载** → 按 F12 看是否有 `[LocGallery]` 或 movi-player 报错；异常文件会自动重封装，硬解不支持的可点「用外部播放器打开」

## 十六、已知限制

1. 主要为 Windows 环境优化
2. 单用户本地，无认证
3. 大库首次打开当前页时，缩略图按需生成，可能有短暂等待
4. HEVC/AV1 等现代编码依赖浏览器硬解（Chromium 94+ / 104+），老浏览器可能无法内嵌播放（可用外部播放器兜底）

## 许可证

私有项目，仅供个人使用。

---

**Loc Gallery** — 本地视频，浏览器里看。

讨论与交流 → [LINUX.DO 社区](https://linux.do)
