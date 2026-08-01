# Loc Gallery Vue

> Loc Gallery v8.2.0 — 本地视频画廊 Web 服务（Vue 3 重构版）

基于 [Loc Gallery v8.1.0](F:\Loc-Gallery) 的完整前端重构，保留 FastAPI 后端媒体处理能力。

## 状态

🟡 **规划完成，待实施**

完整文档见 [`doc/`](./doc/) 目录。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + Vite + TypeScript + Pinia + Tailwind CSS 4 |
| 后端 | FastAPI + uvicorn + ffmpeg |
| 播放 | hls.js + HTML5 Video |
| 测试 | Vitest + Playwright + pytest |

## 快速开始

> 实施完成后可用

```powershell
# 一键启动
python restart.py
# 访问 http://127.0.0.1:3456
```

## 文档

| 文档 | 说明 |
|------|------|
| [文档索引](./doc/README.md) | 全部文档导航 |
| [项目分析](./doc/01-project-analysis.md) | 现有项目全景调研 |
| [移植方案](./doc/02-migration-plan.md) | 重构策略与里程碑 |
| [架构设计](./doc/03-architecture-design.md) | 目标架构与模块划分 |
| [实施步骤](./doc/04-implementation-steps.md) | 分阶段任务清单 |
| [API 映射](./doc/05-api-mapping.md) | 60+ 端点对接表 |
| [功能清单](./doc/06-feature-checklist.md) | 124 项验收清单（含数据复用） |
| [主题设计](./doc/07-theme-design.md) | 3 套主题预设 |
| [测试验收](./doc/08-testing-acceptance.md) | 测试策略与标准 |
| [前期准备](./doc/09-prerequisites.md) | 环境检查清单 |
| [Agent 手册](./doc/10-agent-runbook.md) | 自主执行指南 |

## 重构范围

- ✅ 前端：6500 行 app.js → Vue 3 组件化
- ✅ 样式：3091 行 style.css → Tailwind + CSS Variables
- ✅ 主题：3 套现代视频站风格（Netflix/YouTube/Spotify）
- ⬜ 后端：Router 拆分（逻辑不变）
- ⬜ 测试：单元 + E2E + 后端

## 约束

- **纯本地开发**：禁止 push/pull/fetch/gh，不碰远程仓库
- **源项目只读**：`F:\Loc-Gallery` 仅作对照，不修改
- **100% 移植**：112 项功能全部完成才交付，用户确认后才考虑发布
- **数据复用**：交付时附带完整 data/，视频库与缩略图与源项目一致，开箱即用

详见 [`doc/00-constraints.md`](./doc/00-constraints.md) 和 [`doc/11-data-migration.md`](./doc/11-data-migration.md)
