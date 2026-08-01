# 11 — 数据与视频库复用方案

> **交付目标**：用户拿到 `F:\Loc-Gallery-Vue` 后，**开箱即用**——功能、视频库、缩略图、收藏、历史、专辑与源项目 8.1.0 **完全一致**，无需重新扫描或重新生成缩略图。

---

## 1. 为什么可以直接复用

Vue 重构**只换前端**，后端数据层**原样保留**：

| 不变项 | 说明 |
|--------|------|
| 视频 ID 算法 | `md5(相对路径)`，见 `scanner.py` `_make_id` |
| 数据目录结构 | `data/libraries/{library_id}/` 布局不变 |
| JSON 文件格式 | favorites / history / albums / category_meta 不变 |
| 缩略图索引 | `.thumbs/index.json` + JPEG 文件不变 |
| API 端点 | `/api/thumb/{id}`、`/api/videos` 等不变 |
| 视频文件位置 | `libraries.json` 中的路径指向磁盘原位置，不搬家 |

**结论**：只要新项目使用同一份 `data/` 目录，所有 ID、缩略图、收藏、历史自动对齐，零重新生成。

---

## 2. 数据目录结构（源项目现有）

```
F:\Loc-Gallery\data\                          ← 运行时数据根目录
├── settings.json                             ← 全局设置（主题、播放器等）
├── libraries.json                            ← 视频库注册表（路径、别名）
├── logs\
├── .server.pid
└── libraries\
    └── {library_id}\                         ← 如 lib-default
        ├── favorites.json                    ← 收藏
        ├── play_history.json                 ← 播放历史与续播位置
        ├── albums.json                       ← 专辑
        ├── category_meta.json                ← 分类排序
        ├── settings.json                     ← 按库设置（可选）
        ├── .thumbs\
        │   ├── index.json                    ← 缩略图索引 + 时长
        │   └── {video_id}.jpg                ← 缩略图文件
        └── cache\
            ├── hls\                          ← HLS 切片缓存
            ├── playback_plans.json           ← 播放策略缓存
            └── format_index.json             ← 格式分类索引
```

**视频文件本身**不在 `data/` 里，而在 `libraries.json` 注册的路径下（如 `F:\AVV\`）。

---

## 3. 复用策略

### 3.1 开发期：软链共享（推荐）

开发时通过目录联接共享源项目数据，**只读优先，避免污染源项目**：

```powershell
# 在 F:\Loc-Gallery-Vue 创建目录联接（仅需执行一次）
cd F:\Loc-Gallery-Vue
cmd /c mklink /J data F:\Loc-Gallery\data
```

| 优点 | 说明 |
|------|------|
| 零复制 | 不占用双倍磁盘 |
| 缩略图即时可用 | 无需重新生成 |
| 数据一致 | 与源项目看到相同库 |

| 注意 | 说明 |
|------|------|
| 开发期写入 | 收藏/历史等操作会写入共享 data，开发时尽量用只读验证；或先复制再开发 |
| 源项目不受影响 | 视频文件路径不变，仅 data 目录共享 |

### 3.2 交付期：完整复制（最终交付）

验收通过后，将 `data/` **完整复制**到新项目，形成独立可用的完整项目：

```powershell
# 交付前执行：复制数据（非软链）
xcopy /E /I /H F:\Loc-Gallery\data F:\Loc-Gallery-Vue\data

# 若开发期用了软链，先删除联接再复制：
# rmdir F:\Loc-Gallery-Vue\data
# xcopy /E /I /H F:\Loc-Gallery\data F:\Loc-Gallery-Vue\data
```

交付后 `F:\Loc-Gallery-Vue\data\` 是**独立副本**，与源项目完全解耦。

### 3.3 禁止的做法

| 做法 | 原因 |
|------|------|
| 新建空 `data/` 重新扫描 | 丢失已有缩略图、收藏、历史 |
| 修改视频 ID 算法 | 所有索引失效 |
| 修改 JSON 文件格式 | 后端 store 模块不兼容 |
| 移动视频文件位置 | `libraries.json` 路径失效 |

---

## 4. 新项目配置对应关系

### 4.1 后端 `config.py`

复制源项目后端后，`DATA_DIR` 指向新项目自己的 data：

```python
# F:\Loc-Gallery-Vue\backend\src\loc_gallery\config.py
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # 指向 Loc-Gallery-Vue 根
DATA_DIR = PROJECT_ROOT / "data"
```

**不需要**指向 `F:\Loc-Gallery\data`（交付后应自包含）。

### 4.2 前端缩略图 URL

与源项目完全一致，无变化：

```
GET /api/thumb/{video_id}?library_id={lib_id}&v={thumbVersion}
```

前端 `VideoCard` 组件使用相同 URL 构建逻辑（见 `05-api-mapping.md` §13）。

### 4.3 视频库路径

`libraries.json` 中的 `path` 字段保持原路径（如 `F:\AVV`），**视频文件不移动**。新项目读取同一份 `libraries.json`，扫描同一磁盘目录。

### 4.4 多库隔离

每个 `library_id` 有独立的 `data/libraries/{id}/` 子目录。切换库时：
- 前端传 `library_id` 查询参数
- 后端 `contextvars` 切换库上下文
- 缩略图、收藏、历史按库隔离

**与源项目行为完全一致，无需额外映射。**

---

## 5. 对应关系验证清单

实施完成后，逐项验证数据对齐：

| # | 验证项 | 方法 | 预期 |
|---|--------|------|------|
| D.1 | 库列表一致 | 对比两边 `/api/libraries` | 相同库数量、别名、路径 |
| D.2 | 分类一致 | 对比 `/api/categories` | 相同分类名和数量 |
| D.3 | 视频数量一致 | 对比 `/api/videos?category=X` total | 相同 total |
| D.4 | 视频 ID 一致 | 抽 5 个视频对比 id 字段 | MD5 相同 |
| D.5 | 缩略图显示 | 打开画廊，目视检查 | 缩略图即时显示，无重新生成 |
| D.6 | 缩略图版本 | 对比 `thumbVersion` 字段 | 相同 |
| D.7 | 收藏一致 | 对比 `/api/videos?favorites=true` | 相同视频列表 |
| D.8 | 历史一致 | 对比 `/api/videos?history=true` | 相同记录和续播位置 |
| D.9 | 专辑一致 | 对比 `/api/albums` | 相同专辑和内容 |
| D.10 | 设置一致 | 对比 `/api/settings` | 相同配置项 |
| D.11 | 播放策略缓存 | 播放同一视频，对比 mode | 相同 direct/hls 策略 |
| D.12 | 格式索引 | 对比格式角标 | 相同角标 |

**12/12 全部通过，数据复用验收才算完成。**

---

## 6. 实施步骤（写入 M1 脚手架阶段）

### 步骤 1：复制后端到 `F:\Loc-Gallery-Vue\backend\`

```powershell
xcopy /E /I F:\Loc-Gallery\src F:\Loc-Gallery-Vue\backend\src
xcopy /E /I F:\Loc-Gallery\tests F:\Loc-Gallery-Vue\backend\tests
copy F:\Loc-Gallery\pyproject.toml F:\Loc-Gallery-Vue\backend\
copy F:\Loc-Gallery\requirements.txt F:\Loc-Gallery-Vue\backend\
```

### 步骤 2：联接或复制 data

```powershell
# 开发期（软链）
cd F:\Loc-Gallery-Vue
cmd /c mklink /J data F:\Loc-Gallery\data
```

### 步骤 3：修正 `config.py` 路径

确保 `PROJECT_ROOT` 指向 `F:\Loc-Gallery-Vue`，`DATA_DIR = PROJECT_ROOT / "data"`。

### 步骤 4：验证后端可读取现有数据

```powershell
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m uvicorn loc_gallery.server:app --port 3458
# GET http://127.0.0.1:3458/api/libraries → 应返回现有库
# GET http://127.0.0.1:3458/api/videos → 应返回现有视频，缩略图 thumbReady=true
```

### 步骤 5：交付前复制 data 为独立副本

```powershell
# 删除软链，复制实体目录
rmdir F:\Loc-Gallery-Vue\data
xcopy /E /I /H F:\Loc-Gallery\data F:\Loc-Gallery-Vue\data
```

---

## 7. 最终交付物

用户收到的 `F:\Loc-Gallery-Vue\` 应是：

```
F:\Loc-Gallery-Vue\
├── frontend\          ← Vue 3 前端（构建后 dist/）
├── backend\           ← FastAPI 后端（与源项目逻辑一致）
├── data\              ← 完整数据副本（库/缩略图/收藏/历史/专辑）
├── config\
├── scripts\
├── restart.py         ← 一键启动
├── README.md
└── doc\
```

**使用方式**：

```powershell
cd F:\Loc-Gallery-Vue
python restart.py
# 浏览器打开 http://127.0.0.1:3460
# 看到与源项目相同的视频库、缩略图、收藏、历史
```

**不需要**：
- 重新注册视频库
- 重新扫描
- 重新生成缩略图
- 重新配置设置

---

## 8. 与硬性约束的关系

| 约束 | 数据复用如何满足 |
|------|------------------|
| 不修改源项目 | 开发期软链只读验证；交付期复制独立副本 |
| 100% 功能一致 | 同一 data → 同一收藏/历史/专辑/缩略图 |
| 开箱即用 | 交付时 data 随项目一起交付 |
| 纯本地 | 视频路径仍指向本地磁盘，无云依赖 |
