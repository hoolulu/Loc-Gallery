# Loc Gallery Vue 重构文档体系

> **项目**：Loc Gallery v8.1.0 → Loc-Gallery-Vue v8.2.0  
> **源项目**：`F:\Loc-Gallery`（当前 8.1.0）  
> **目标项目**：`F:\Loc-Gallery-Vue`  
> **创建日期**：2026-08-02  
> **最后同步**：2026-08-02（源项目 8.1.0）  
> **状态**：规划完成，待实施

---

## 文档索引

| 编号 | 文档 | 用途 | 读者 |
|------|------|------|------|
| 00 | [硬性约束](./00-constraints.md) | **纯本地、禁止远程、100% 移植** | **所有人必读** |
| 01 | [项目分析报告](./01-project-analysis.md) | 现有项目全景调研、技术债、功能清单 | 所有人 |
| 02 | [移植方案总纲](./02-migration-plan.md) | 重构策略、技术选型、里程碑 | 决策者 / 开发者 |
| 03 | [目标架构设计](./03-architecture-design.md) | 目录结构、模块边界、状态管理 | 开发者 |
| 04 | [详细实施步骤](./04-implementation-steps.md) | 分阶段任务清单、每步交付物 | 开发者 / Agent |
| 05 | [API 对接映射](./05-api-mapping.md) | 60+ 端点完整映射到前端模块 | 开发者 |
| 06 | [功能移植清单](./06-feature-checklist.md) | 124 项对照表（功能+数据复用），验收勾选 | 验收 / Agent |
| 07 | [主题系统设计](./07-theme-design.md) | 6 套主题预设、CSS 变量、布局模式 | 开发者 / 设计 |
| 08 | [测试与验收标准](./08-testing-acceptance.md) | 自动化测试、手动验收、回归矩阵 | 验收 / Agent |
| 09 | [前期准备清单](./09-prerequisites.md) | 环境、工具、样本数据、启动前检查 | 实施前必读 |
| 10 | [Agent 执行手册](./10-agent-runbook.md) | 自主执行流程、自检循环、异常处理 | Agent 专用 |
| 11 | [数据复用方案](./11-data-migration.md) | 视频库/缩略图/收藏复用与交付标准 | 开发者 / 验收 |

---

## 阅读顺序

### 用户（决策者）

1. `01-project-analysis.md` — 了解现状
2. `02-migration-plan.md` — 确认方案
3. `09-prerequisites.md` — 准备环境
4. 审阅完毕后通知 Agent 开始实施

### Agent（实施者）

1. `09-prerequisites.md` — 环境检查
2. `10-agent-runbook.md` — 执行流程
3. `04-implementation-steps.md` — 按阶段执行
4. `05-api-mapping.md` + `06-feature-checklist.md` — 逐项对接
5. `08-testing-acceptance.md` — 每阶段验收

---

## 核心决策摘要

| 决策项 | 选择 |
|--------|------|
| 重构路线 | 渐进式（新旧并行，后端保留） |
| 前端框架 | Vue 3 + Vite + TypeScript + Pinia |
| UI 组件 | shadcn-vue / Radix-Vue + Tailwind CSS 4 |
| 后端 | 保留 FastAPI，Router 拆分（从源项目复制并优化） |
| 默认主题 | Netflix 沉浸影院 + Spotify 底部播放条 |
| 数据层 | 第一阶段保持 JSON 文件存储 |
| 目标目录 | `F:\Loc-Gallery-Vue` |
| 源项目基线 | **8.1.0** |
| 交付版本 | **8.2.0**（Vue 重构版） |

---

## 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-08-02 | 初始文档体系建立 |
| 0.1.3 | 2026-08-02 | 数据复用：交付开箱即用，复用源项目视频库与缩略图 |
