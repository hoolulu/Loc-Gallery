# Changelog

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
