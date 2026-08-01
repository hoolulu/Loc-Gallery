# 09 — 前期准备清单

> 在开始实施前，请逐项确认。Agent 在阶段 1 开始前必须全部检查通过。  
> **源项目基线版本：8.1.0**（2026-08-02 发布）

---

## 1. 环境要求

### 1.1 必需软件

| 软件 | 最低版本 | 检查命令 | 状态 |
|------|----------|----------|------|
| Python | 3.11+ | `python --version` | ☐ |
| Node.js | 20+ | `node --version` | ☐ |
| npm | 10+ | `npm --version` | ☐ |
| ffmpeg | 任意 | `ffmpeg -version` | ☐ |
| ffprobe | 任意 | `ffprobe -version` | ☐ |
| Git | 任意 | `git --version` | ☐ |

### 1.2 可选软件

| 软件 | 用途 | 状态 |
|------|------|------|
| PotPlayer | 外部播放测试 | ☐ |
| VS Code / Cursor | 开发 IDE | ☐ |
| Chrome / Edge | E2E 测试浏览器 | ☐ |

---

## 2. 源项目确认

### 2.1 源项目可运行

```powershell
cd F:\Loc-Gallery
python restart.py
# 确认 http://127.0.0.1:3460 可访问
# 确认至少一个视频库有数据
```

| 检查项 | 状态 |
|--------|------|
| 源项目可启动 | ☐ |
| 源项目版本为 8.1.0 | ☐ |
| 浏览器可访问 | ☐ |
| 至少 1 个视频库已注册 | ☐ |
| 至少 1 个分类有视频 | ☐ |
| 至少 1 个视频可播放 | ☐ |
| 缩略图正常显示 | ☐ |

### 2.2 源项目测试通过

```powershell
cd F:\Loc-Gallery
$env:PYTHONPATH = "src"
python -m pytest tests/ -v
```

| 检查项 | 状态 |
|--------|------|
| 全部测试通过 | ☐ |

---

## 3. 测试数据准备

### 3.1 数据目录策略

**开发期**：目录联接共享 `F:\Loc-Gallery\data`（见 `11-data-migration.md` §3.1）

```powershell
cd F:\Loc-Gallery-Vue
cmd /c mklink /J data F:\Loc-Gallery\data
```

**交付前**：复制为独立副本（见 `11-data-migration.md` §3.2）

| 检查项 | 状态 |
|--------|------|
| data 目录可访问 | ☐ |
| libraries.json 与源项目一致 | ☐ |
| 缩略图 index.json 存在 | ☐ |
| `/api/videos` 返回 thumbReady=true | ☐ |
| 至少 1 个库目录有数据 | ☐ |

### 3.2 测试视频样本

为完整测试播放功能，建议准备以下样本（如无则跳过对应测试）：

| 类型 | 用途 | 是否存在 |
|------|------|----------|
| 标准 H.264 MP4（< 100MB） | direct 播放测试 | ☐ |
| 大文件 MP4（> 500MB） | HLS copy 测试 | ☐ |
| moov 在末尾的 MP4 | HLS copy 测试 | ☐ |
| 碎片化 H.264 MP4 | remux 测试 | ☐ |
| AV1/HEVC 编码 | HLS 转码测试 | ☐ |
| 伪装 PNG 的 MPEG-TS | 特殊格式测试 | ☐ |

---

## 4. 端口规划

| 服务 | 端口 | 用途 |
|------|------|------|
| 源项目 | 3456 | 保留运行，作为对照 |
| 新后端（开发） | 3458 | Vue 项目后端 |
| 新前端（开发） | 3457 | Vite dev server |
| 新项目（生产） | 3460 | restart.py 一键启动 |

确认端口未被占用：

```powershell
netstat -ano | findstr "3456 3457 3458 3460"
```

| 检查项 | 状态 |
|--------|------|
| 3456 被源项目占用（正常） | ☐ |
| 3457 可用 | ☐ |
| 3458 可用 | ☐ |
| 3460 可用 | ☐ |

---

## 5. 目录结构初始化

实施前确认以下目录存在：

```
F:\Loc-Gallery-Vue\
├── doc/          ✅ 已创建
├── frontend/     ☐ 阶段 1 创建
├── backend/      ☐ 阶段 1 创建
├── scripts/      ☐ 阶段 1 创建
├── config/       ☐ 阶段 1 创建
├── data/         ☐ 软链或复制
└── restart.py    ☐ 阶段 1 创建
```

---

## 6. Git 初始化（可选，仅本地）

```powershell
cd F:\Loc-Gallery-Vue
git init
# 创建 .gitignore
```

> **严禁** `git push`、`git remote add`、或任何与远程仓库相关的操作。  
> Git 仅用于 `F:\Loc-Gallery-Vue` 本地快照，方便回滚。不得影响 `F:\Loc-Gallery`。

`.gitignore` 内容：

```
node_modules/
frontend/dist/
frontend/.vite/
__pycache__/
*.pyc
.pytest_cache/
data/
*.log
.env
.DS_Store
```

| 检查项 | 状态 |
|--------|------|
| Git 仓库初始化（仅本地） | ☐ |
| .gitignore 创建 | ☐ |
| 确认无 remote 配置 | ☐ |
| 确认未修改 F:\Loc-Gallery | ☐ |

---

## 7. 文档审阅

| 文档 | 用户已审阅 | 状态 |
|------|-----------|------|
| 01-project-analysis.md | ☐ | 待审阅 |
| 02-migration-plan.md | ☐ | 待审阅 |
| 03-architecture-design.md | ☐ | 待审阅 |
| 04-implementation-steps.md | ☐ | 待审阅 |
| 05-api-mapping.md | ☐ | 待审阅 |
| 06-feature-checklist.md | ☐ | 待审阅 |
| 07-theme-design.md | ☐ | 待审阅 |
| 08-testing-acceptance.md | ☐ | 待审阅 |
| 09-prerequisites.md | ☐ | 待审阅 |
| 10-agent-runbook.md | ☐ | 待审阅 |

---

## 8. 风险确认

| 风险 | 用户知晓 | 缓解措施 |
|------|----------|----------|
| 播放器逻辑复杂，可能遗漏边界情况 | ☐ | 逐函数对照 + E2E 测试 |
| HLS 切片行为可能因重构有差异 | ☐ | 保留原逻辑，对比测试 |
| 大库性能可能下降 | ☐ | 虚拟滚动 |
| 后端 Router 拆分可能引入 bug | ☐ | 保留原 server.py 对照 |
| 主题还原度可能不足 | ☐ | 3 套主题可调整 |

---

## 9. 启动确认

全部检查通过后，用户确认开始实施：

```
□ 我已审阅全部文档
□ 环境检查全部通过
□ 测试数据已准备
□ 同意按推荐方案（Vue 3 + 渐进式重构）执行
□ 授权 Agent 自主执行直到验收完成

确认人：__________
确认时间：__________
```

---

## 10. Agent 启动指令

用户确认后，Agent 应执行：

```
1. 读取 10-agent-runbook.md
2. 执行 09-prerequisites.md 全部检查
3. 按 04-implementation-steps.md 从阶段 1 开始
4. 每阶段结束按 08-testing-acceptance.md 验收
5. 全程对照 06-feature-checklist.md 勾选
6. 遇到问题先自行解决，无法解决时记录 blocker
7. 全部阶段完成后输出验收报告（112 项功能清单）
```
