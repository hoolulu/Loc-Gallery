# 02 — 移植方案总纲

> 目标：将 Loc Gallery v8.1.0 完整移植到 Vue 3 前端，保留 FastAPI 后端  
> 目标目录：`F:\Loc-Gallery-Vue`  
> 交付版本：v8.2.0（Vue 重构版）

---

## 1. 重构策略

### 1.1 选定路线：渐进式重构

```
阶段 0：文档与脚手架
阶段 1：后端复制 + Router 拆分
阶段 2：前端基础框架 + API 层
阶段 3：核心视图（画廊/分类/搜索）
阶段 4：播放器完整移植
阶段 5：收藏/历史/专辑
阶段 6：设置/批量/文件管理
阶段 7：主题系统
阶段 8：集成测试 + 验收
```

**原则**：
- 后端媒体管线（ffmpeg/HLS/缩略图）**零改动逻辑**，仅做结构拆分
- 前端**全新编写**，通过现有 API 对接
- 每个阶段可独立验收，不阻塞后续
- 新旧可并行运行（不同端口）直到切换

### 1.2 不做的范围

| 项目 | 原因 |
|------|------|
| 换后端语言 | Python + ffmpeg 生态成熟 |
| 引入数据库 | 第一阶段 JSON 够用，降低风险 |
| Tauri 桌面壳 | 偏离 PRD「浏览器打开」定位 |
| 移动端适配 | PRD 非目标 |
| 多用户/权限 | PRD 非目标 |

---

## 2. 技术选型

### 2.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue | 3.5+ | 核心框架 |
| Vite | 6+ | 构建工具 |
| TypeScript | 5+ | 类型安全 |
| Pinia | 2+ | 状态管理 |
| Vue Router | 4+ | 路由（视图模式） |
| Tailwind CSS | 4+ | 样式框架 |
| shadcn-vue | latest | UI 组件（Dialog/Dropdown/Toast） |
| @tanstack/vue-virtual | latest | 大列表虚拟滚动 |
| @vueuse/core | latest | 工具函数（SSE/localStorage/全屏） |
| hls.js | latest | HLS 播放（保留） |
| Vitest | latest | 单元测试 |
| Playwright | latest | E2E 测试 |

### 2.2 后端

| 技术 | 变更 |
|------|------|
| FastAPI | 保留，Router 拆分 |
| uvicorn | 保留 |
| 所有 store 模块 | 原样复制 |
| 所有 media 模块 | 原样复制 |

### 2.3 开发工具

| 工具 | 用途 |
|------|------|
| ESLint + Prettier | 代码规范 |
| vue-tsc | 类型检查 |
| concurrently | 前后端并行开发 |

---

## 3. 目标目录结构

```
F:\Loc-Gallery-Vue\
├── doc/                           # 本文档体系
├── frontend/                      # Vue 3 前端
│   ├── src/
│   │   ├── api/                   # API 客户端
│   │   ├── components/            # 通用组件
│   │   ├── composables/           # 组合式函数
│   │   ├── layouts/               # 布局组件
│   │   ├── pages/                 # 页面视图
│   │   ├── stores/                # Pinia stores
│   │   ├── themes/                # 主题预设
│   │   ├── types/                 # TypeScript 类型
│   │   ├── utils/                 # 工具函数
│   │   ├── App.vue
│   │   └── main.ts
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
├── backend/                       # FastAPI 后端（从源项目复制）
│   ├── src/loc_gallery/
│   │   ├── routers/               # 拆分后的路由
│   │   │   ├── libraries.py
│   │   │   ├── categories.py
│   │   │   ├── videos.py
│   │   │   ├── favorites.py
│   │   │   ├── history.py
│   │   │   ├── albums.py
│   │   │   ├── thumbs.py
│   │   │   ├── play.py
│   │   │   ├── settings.py
│   │   │   └── events.py
│   │   ├── server.py              # 精简后的入口
│   │   └── ...（其他模块原样）
│   ├── tests/
│   ├── pyproject.toml
│   └── requirements.txt
├── scripts/
│   ├── dev.ps1                    # 开发模式启动
│   ├── build.ps1                  # 生产构建
│   └── restart.py                 # 一键重启
├── config/
├── data/                          # 运行时数据（可软链到源项目）
├── restart.py                     # 生产入口
├── pyproject.toml
└── README.md
```

---

## 4. 里程碑规划

### M0：文档与准备（当前阶段）

- [x] 项目分析报告
- [x] 移植方案文档
- [x] 功能清单与验收标准
- [ ] 环境准备确认

**交付物**：`doc/` 完整文档体系

### M1：脚手架搭建（预计 1 天）

- [ ] 创建 `frontend/` Vite + Vue + TS 项目
- [ ] 配置 Tailwind CSS 4 + shadcn-vue
- [ ] 复制后端到 `backend/`，验证可启动
- [ ] 配置 Vite 代理 `/api` → 后端
- [ ] 创建基础布局骨架

**验收**：`npm run dev` 可访问空白页，后端 `/api/health` 返回 ok

### M2：API 层与状态管理（预计 1 天）

- [ ] 实现 `api/client.ts` 统一请求封装
- [ ] 实现所有 API 模块（见 `05-api-mapping.md`）
- [ ] 创建 Pinia stores：library、settings、ui
- [ ] 实现 SSE 连接 composable
- [ ] 定义所有 TypeScript 类型

**验收**：API 层单元测试通过，可获取库列表和设置

### M3：核心画廊视图（预计 2 天）

- [ ] AppHeader 组件（导航/搜索/库切换）
- [ ] CategorySidebar 组件（分类树/拖拽排序）
- [ ] VideoGrid 组件（虚拟滚动网格）
- [ ] VideoCard 组件（缩略图/收藏/格式角标）
- [ ] 分页/排序/搜索联动
- [ ] URL 状态同步

**验收**：可浏览分类、翻页、搜索，缩略图正常显示

### M4：播放器完整移植（预计 3 天）

- [ ] PlayerView 全屏播放器布局
- [ ] 播放策略检测流程（direct/hls/external）
- [ ] HLS 播放 + 切片节流
- [ ] 断点续播 + 位置保存
- [ ] 播放列表 + 连播
- [ ] Remux 修复流程
- [ ] PotPlayer 外部播放
- [ ] 键盘快捷键

**验收**：可播放各类格式视频，续播/连播正常，HLS 切片正常

### M5：收藏/历史/专辑（预计 2 天）

- [ ] FavoritesView 收藏视图
- [ ] HistoryView 历史视图
- [ ] AlbumsView 专辑列表
- [ ] AlbumDetailView 专辑详情
- [ ] 专辑 CRUD 对话框
- [ ] 加入专辑选择器

**验收**：收藏/历史/专辑全流程可用

### M6：设置与批量管理（预计 2 天）

- [ ] SettingsDialog 设置对话框（4 个标签页）
- [ ] 库管理（添加/编辑/删除/切换）
- [ ] 批量选择模式
- [ ] 批量操作栏（删除/移动/收藏/修复）
- [ ] 所有右键菜单
- [ ] 文件/文件夹操作对话框

**验收**：设置可保存，批量操作正常，右键菜单完整

### M7：主题系统（预计 1 天）

- [ ] CSS Variables 设计令牌
- [ ] 3 套主题预设（Netflix/YouTube/Spotify）
- [ ] 暗/亮模式切换
- [ ] 主题预览与切换 UI
- [ ] 设置持久化

**验收**：主题可切换，暗亮模式正常

### M8：集成测试与验收（预计 2 天）

- [ ] Playwright E2E 测试套件
- [ ] 按 `06-feature-checklist.md` 逐项验收
- [ ] 性能对比（大库加载时间）
- [ ] 修复所有验收失败项
- [ ] 生产构建 + 部署脚本

**验收**：全部功能清单勾选通过，无 P0/P1 bug

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 播放器逻辑遗漏 | 中 | 高 | 逐函数对照 app.js，E2E 覆盖 |
| HLS 切片节流行为差异 | 中 | 高 | 保留原逻辑，对比测试 |
| 样式还原度不足 | 低 | 中 | 截图对比，主题可调 |
| 大库性能下降 | 低 | 中 | 虚拟滚动，懒加载 |
| SSE 重连问题 | 低 | 中 | 复用原重连逻辑 |
| 后端拆分引入 bug | 低 | 高 | 保留原 server.py 对照，跑现有测试 |

---

## 6. 切换策略

### 开发期间

- 源项目 `F:\Loc-Gallery` 继续在 `:3456` 运行
- 新项目 `F:\Loc-Gallery-Vue` 开发在 `:3457`（前端 Vite）+ `:3458`（后端）
- `data/` 可软链到源项目共享测试数据

### 验收通过后

1. 生产构建：`npm run build` → `frontend/dist/`
2. 后端托管 `dist/` 静态文件
3. 更新 `restart.py` 指向新项目
4. 源项目保留作为回滚备份

---

## 7. 成功标准

1. **功能完整**：`06-feature-checklist.md` **112/112 全部勾选**
2. **播放可靠**：direct/HLS/remux/external 四类场景通过
3. **零已知 bug**：全部修复后才报告完成
4. **性能不降级**：1000+ 视频库翻页流畅
5. **纯本地**：不与远程仓库发生任何关系
6. **源项目不受影响**：`F:\Loc-Gallery` 只读不动
