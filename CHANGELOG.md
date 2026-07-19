# Changelog

## [3.0.0] - 2026-07-20

**稳定版**：HTML5 直连读盘与播放页体验集中修复，推荐升级。

### 新增

- **`/api/stream` 小块流式传输**（`range_stream.py`）：256KB 分块 + 客户端断开即停读盘，替代整段 `FileResponse` 全速抽读
- 设置项 **HTML5 播放列表连播**、**HTML5 记忆播放位置**（可关闭）
- `/api/play/info` 返回 **续播进度**（`playPosition` / `playDuration`）

### 改进

- 播放时磁盘读取接近 **码率级缓冲**（约 2–3 MB/s），不再长时间 100% 猛读
- 退出/切换时 **`hard` 重建 `<video>`**，尽快取消浏览器 Range 请求
- 关页 `pagehide` 用 **keepalive** 保存续播进度
- 续播 **seek 等待 `seeked`**；播放页内点列表 **立即切换**（先递增 `playSession`，进度异步保存）
- 播放列表 **事件委托**，避免重绘后点击失效

### 修复

- 中文文件名 `Content-Disposition` 导致 `/api/stream` 500、全部「视频加载失败」
- 播放页右侧列表切换无反应
- 连播 `ended` 在重建 video 节点后丢失
- 记忆播放位置未从服务端刷新时不续播

## [2.2.0] - 2026-07-20

### 新增

- **碎片化 MP4 修复**：流复制重封装为标准 MP4（faststart）；播放信息返回 `remux_reason`；支持批量「修复为标准 MP4」
- 缩略图 **「非标准」角标**（碎片化 / 伪装 TS）
- 碎片化且策略为「本地播放器」时，弹窗选择 **PotPlayer** 或 **修复**

### 改进

- **默认播放方式改为 HTML5**；修复曾将 `html5` 误读为 `smart` 导致仍走 PotPlayer 的问题
- 播放计划 **v13**：前部扫描 `moof` 以识别碎片化 MP4；策略标签含版本号便于缓存失效
- **退出播放页** 加强断流（HLS `stopLoad`、直连取消、切片任务停止），减轻退出后持续读盘
- remux 替换原文件时 **占用重试**，大文件备份提示更明确
- AV1/HEVC/VP9、伪装 TS、大文件等恢复 **自动 HLS/转码**；仅碎片化 `external` 弹窗

### 修复

- PotPlayer 模式下点击卡片可正常调起外部播放器

## [2.1.0] - 2026-07-20

### 新增

- **HTML5 续播**：播放进度写入 `play_history.json`（`position_sec`），下次打开同一视频从上次位置继续（直连与 HLS；HLS 通过 hls.js `startPosition`）
- **暂停播放时挂起 ffmpeg 切片**（Windows 进程挂起），继续播放时恢复；切换视频、返回列表、关闭页面仍停止切片进程
- API：`POST /api/history/position` 保存进度；`POST /api/play/pause` / `POST /api/play/resume` 控制切片进程挂起/恢复

### 改进

- HLS 片段时长 **6 秒 → 30 秒**，显著减少小文件数量与机械硬盘 I/O
- 去掉 HLS `temp_file` 标志，避免每段双写
- 切片缓存元数据增加 `segment_seconds`，调整片段参数后旧缓存自动失效并重新切片

### 修复

- 移除强制将播放头归零的逻辑，修复「记忆播放位置」无效的问题
- **PotPlayer 默认播放**：点击缩略图无反应；改为调用 `/api/play-external/`，并与合并后的播放设置同步

## [2.0.2] - 2026-07-20

### 新增

- 播放页顶栏增加 **收藏 / 取消收藏** 按钮

### 修复

- **HLS 边切边播** 首次播放不从开头起播：hls.js 误判为直播跳到最新片段；现通过 `startPosition: 0`、清单注入 `EVENT`/`START` 标记及 ffmpeg `event` 播放列表类型修复

## [2.0.1] - 2026-07-19

### 变更

- Python 包 **`avv_gallery`** 重命名为 **`loc_gallery`**，源码目录改为 `src/loc_gallery/`
- 更新所有 import、uvicorn 入口、文档、脚本与测试中的模块路径
- `package-lock.json` 与 demo 页面品牌统一为 Loc Gallery

## [2.0.0] - 2026-07-19

### 新增

- **多视频库**：注册多个本地根目录，顶栏「选择视频库」切换；收藏、历史、缩略图、HLS 缓存、分类元数据按库隔离
- **视频库 API**：`GET/POST/PATCH/DELETE /api/libraries`、激活、Windows 文件夹选择器
- **设置面板重构**：视频库（现有 / 新增）+ 全局选项；PotPlayer 路径自动探测
- **播放列表排序**：文件名自然排序、标题、时间、大小等；排序偏好本地保存
- **HTML5 连播**：按播放列表顺序自动播放下一集；上一个 / 下一个同步列表顺序
- **集成测试**：`tests/test_multi_library.py`

### 改进

- 单库数据自动迁移至 `data/libraries/lib-default/`
- 现有 API 支持 `?library_id=`；SSE 事件携带库 ID
- 播放与 PotPlayer 启动逻辑修复（路径校验、设置回退）

### 说明

- 应用版本号统一为 **2.0.0**（Python 包当时仍为 `avv_gallery`，见 2.0.1）
- 全局设置保存在 `data/settings.json`；库列表在 `data/libraries.json`

## [1.0.0] - 更早版本

- 本地视频画廊、缩略图队列、HTML5/HLS 播放、收藏与历史、伪装 MPEG-TS 支持等基础能力
