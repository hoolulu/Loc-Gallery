# 10 — Agent 执行手册

> 本文档为 Agent 自主执行的完整操作指南。  
> 目标：从开始到验收完成，无需用户介入修复 bug。

---

## 1. 执行原则

0. **纯本地**：禁止任何远程仓库操作（push/pull/fetch/gh），禁止修改 `F:\Loc-Gallery`
1. **100% 移植**：112 项功能全部完成，不以 P0/P1 为由提前交付
2. **自主决策**：遇到技术问题先查文档、查源码、尝试修复，不要停下来问用户
3. **逐阶段推进**：严格按 `04-implementation-steps.md` 阶段顺序，不跳步
4. **每步验收**：每完成一个子任务立即自测，失败则修复后重测
5. **对照源码**：前端逻辑必须逐函数对照 `F:\Loc-Gallery\static\app.js`（只读）
6. **记录进度**：更新 `06-feature-checklist.md` 勾选状态
7. **本地 Git**（可选）：仅在 `F:\Loc-Gallery-Vue` 内 `git commit` 作本地快照，**禁止 push**

---

## 2. 启动流程

```
用户确认开始
  ↓
执行 09-prerequisites.md 检查（全部通过）
  ↓
读取 04-implementation-steps.md 当前阶段
  ↓
执行阶段任务
  ↓
运行该阶段测试
  ↓
对照 06-feature-checklist.md 勾选
  ↓
Git commit
  ↓
进入下一阶段（重复）
  ↓
M8 最终验收
  ↓
输出验收报告
```

---

## 3. 阶段执行模板

每个阶段按以下模板执行：

### 3.1 开始前

```
□ 确认上一阶段已全部验收通过
□ 阅读本阶段任务清单
□ 确认依赖的前置模块已完成
```

### 3.2 执行中

```
对每个子任务：
  1. 阅读源文件对应逻辑（app.js / index.html / style.css）
  2. 创建/修改目标文件
  3. 运行 TypeScript 编译检查
  4. 运行相关单元测试
  5. 浏览器手动验证（如适用）
  6. 失败 → 修复 → 重测（最多 3 次）
  7. 3 次仍失败 → 记录 blocker，尝试替代方案
```

### 3.3 阶段结束

```
□ 运行 npm run test（单元测试全部通过）
□ 运行 npx playwright test（E2E 相关测试通过）
□ 运行 npx vue-tsc --noEmit（无类型错误）
□ 执行手动冒烟测试（08-testing-acceptance.md §6.2）
□ 更新 06-feature-checklist.md 勾选
□ Git commit: "feat(M{N}): {阶段描述}"
□ 输出阶段完成报告
```

---

## 4. 关键模块移植指南

### 4.1 播放器（最高风险）

**源文件**：`app.js` L4500-5700

**必须逐函数移植的函数**：

| 源函数 | 目标 | 关键点 |
|--------|------|--------|
| `playVideo` | `usePlayback.playVideo` | 入口，模式分发 |
| `playVideoHtml5` | `usePlayback.playHtml5` | 策略检测 |
| `playVideoExternal` | `usePlayback.playExternal` | PotPlayer |
| `playDirect` | `usePlayback.playDirect` | video.src 直传 |
| `playHls` | `usePlayback.playHls` | prepare + hls.js |
| `waitHlsReady` | `usePlayback.waitHlsReady` | 轮询 status |
| `bindHlsSliceThrottle` | `useHlsThrottle` | 切片节流 |
| `bindPlaybackProgressSaver` | `useResumePlayback` | 位置保存 |
| `recordPlayHistory` | player store | 历史记录 |
| `playAdjacentVideo` | player store | 上一集/下一集 |
| `runVideoRemux` | `usePlayback.remux` | 修复流程 |
| `cancelPlayback` | player store | 取消/关闭 |
| `abortIfStale` | player store | 会话取消 |
| `revealPlayerView` | player store | 显示播放器 |

**验收测试**：
1. 找一个标准 MP4 → direct 播放
2. 找一个大文件 → HLS 播放
3. 播放中拖动进度条 → seek 正常
4. 关闭重开 → 续播位置正确
5. 播完一集 → 自动下一集
6. 快速切换 3 个视频 → 不串台

### 4.2 SSE 实时同步

**源文件**：`app.js` L6261-6298

```typescript
// 必须保留的行为：
// 1. 连接 /api/events?library_id=...
// 2. 解析 version:{libId}:{ver} → debounce 500ms → 重载
// 3. 解析 progress:{libId} → 更新进度条
// 4. 断线 → 5s 后重连
// 5. 切换库 → 关闭旧连接，建立新连接
```

### 4.3 画廊网格

**源文件**：`app.js` L3200-3600

```typescript
// 必须保留的行为：
// 1. 缩略图 URL: /api/thumb/{id}?library_id=...&v={version}
// 2. 当前页 IDs → POST /api/thumb/priority
// 3. 格式角标 → GET /api/play/badges?ids=...
// 4. 时长补全 → GET /api/durations?ids=...
// 5. 分页参数同步到 URL
// 6. 搜索 debounce 300ms
```

### 4.4 设置对话框

**源文件**：`index.html` 设置区域 + `app.js` L5800-6200

4 个标签页，每个设置项必须：
1. 从 `GET /api/settings` 加载
2. 修改后 `POST /api/settings` 保存
3. 保存后立即生效（如播放器模式）

---

## 5. 自检循环

### 5.1 每次修改后

```powershell
# 1. 类型检查
cd F:\Loc-Gallery-Vue\frontend
npx vue-tsc --noEmit

# 2. 单元测试
npm run test

# 3. 浏览器检查
# 打开 http://127.0.0.1:3457
# 检查控制台无 error
```

### 5.2 每阶段结束后

```powershell
# 1. 全部单元测试
npm run test

# 2. E2E 测试
npx playwright test

# 3. 后端测试
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m pytest tests/ -v

# 4. 手动冒烟（08-testing-acceptance.md §6.2 全部 10 项）
```

### 5.3 发现问题时

```
1. 记录问题（描述、复现步骤、优先级）
2. P0/P1 → 立即修复
3. 修复后重新运行自检循环
4. P2/P3 → 记录到 doc/issues.md，继续推进
5. 阶段结束时评估 P2 是否升级为 P1
```

---

## 6. 常见问题处理

### 6.1 后端启动失败

```
检查：
1. PYTHONPATH 是否设置
2. 端口是否被占用
3. ffmpeg 是否在 PATH
4. data/ 目录是否存在

解决：
1. $env:PYTHONPATH = "F:\Loc-Gallery-Vue\backend\src"
2. 换端口或 kill 占用进程
3. 确认 ffmpeg -version 可用
4. 创建软链到源项目 data/
```

### 6.2 前端 API 请求失败

```
检查：
1. Vite 代理配置是否正确
2. 后端是否在 3458 运行
3. library_id 是否正确附加

解决：
1. 检查 vite.config.ts proxy 配置
2. 启动后端
3. 检查 api/client.ts 逻辑
```

### 6.3 播放器无法播放

```
检查：
1. /api/play/info/{id} 返回的 mode
2. 浏览器控制台 network 请求
3. hls.js 是否正确加载

对照源项目：
1. 同一视频在源项目 (3456) 能否播放
2. 对比 play/info 响应
3. 对比 network 请求差异
```

### 6.4 缩略图不显示

```
检查：
1. /api/thumb/{id} 返回状态码
2. thumbVersion 是否正确
3. library_id 是否正确

解决：
1. 检查缩略图 URL 构建
2. 确认 v={version} 参数
3. 触发 priority 队列
```

### 6.5 TypeScript 类型错误

```
原则：
1. 不为通过编译而使用 any
2. 参考 03-architecture-design.md 类型定义
3. API 响应类型与 05-api-mapping.md 一致
```

---

## 7. 进度报告模板

每阶段完成后输出：

```markdown
## 阶段 M{N} 完成报告

**阶段**：{阶段名称}
**耗时**：{实际耗时}
**状态**：✅ 通过 / ❌ 有 blocker

### 完成任务
- [x] 任务 1
- [x] 任务 2
- ...

### 测试结果
- 单元测试：{pass}/{total}
- E2E 测试：{pass}/{total}
- 后端测试：{pass}/{total}
- 冒烟测试：{pass}/10

### 功能清单
- P0：{pass}/{total}
- P1：{pass}/{total}

### 已知问题
| 级别 | 描述 | 状态 |
|------|------|------|
| P2 | ... | 记录 |

### 下一步
进入阶段 M{N+1}：{名称}
```

---

## 8. 最终验收报告模板

全部阶段完成后输出：

```markdown
## Loc Gallery Vue 重构验收报告

**版本**：v8.2.0（基于源项目 8.1.0）
**完成日期**：{date}
**总耗时**：{days}

### 功能完整性
- 06-feature-checklist.md P0：{pass}/{total} ({percent}%)
- 06-feature-checklist.md P1：{pass}/{total} ({percent}%)
- 交付标准：{达标/未达标}

### 测试结果
- 前端单元测试：{pass}/{total}
- 前端 E2E 测试：{pass}/{total}
- 后端测试：{pass}/{total}
- 冒烟测试：10/10

### 性能
- 首页加载：{ms}
- 翻页响应：{ms}
- 播放器起播：{ms}

### 已知问题
| 级别 | 数量 | 说明 |
|------|------|------|
| P0 | 0 | — |
| P1 | {n} | ... |
| P2 | {n} | 记录到 backlog |

### 启动方式
\`\`\`powershell
cd F:\Loc-Gallery-Vue
python restart.py
# 访问 http://127.0.0.1:3460
\`\`\`

### 结论
{可以交付 / 需要修复以下问题}
```

---

## 9. 阻塞处理

当遇到无法自行解决的问题时：

1. **记录 blocker** 到 `doc/blockers.md`：
   ```markdown
   ## Blocker #{n}
   - 时间：{datetime}
   - 阶段：M{N}
   - 描述：{问题}
   - 已尝试：{方案1, 方案2, 方案3}
   - 需要：{用户操作 / 外部资源}
   ```

2. **尝试绕过**：是否有替代方案可继续推进其他任务

3. **暂停当前任务**，继续不依赖该 blocker 的其他任务

4. **阶段结束时汇总** blockers，在报告中标注

---

## 10. 命令速查

```powershell
# === 开发模式 ===
# 终端 1：后端
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m uvicorn loc_gallery.server:app --host 127.0.0.1 --port 3458 --reload

# 终端 2：前端
cd F:\Loc-Gallery-Vue\frontend
npm run dev

# === 测试 ===
cd F:\Loc-Gallery-Vue\frontend
npm run test                    # 单元测试
npx playwright test             # E2E
npx vue-tsc --noEmit            # 类型检查
npm run lint                    # Lint

cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m pytest tests/ -v      # 后端测试

# === 生产构建 ===
cd F:\Loc-Gallery-Vue\frontend
npm run build

cd F:\Loc-Gallery-Vue
python restart.py

# === Git ===
git add -A
git commit -m "feat(M{N}): description"

# === 源项目对照 ===
cd F:\Loc-Gallery
python restart.py
# http://127.0.0.1:3460
```

---

## 11. 执行检查清单

Agent 开始执行前最终确认：

```
□ 已读取全部 10 份文档
□ 09-prerequisites.md 全部检查通过
□ 用户已确认开始实施
□ F:\Loc-Gallery 可正常运行（对照用）
□ 源项目 data/ 已软链或可复制
□ Git 已初始化
□ 清楚每阶段的验收标准
□ 清楚播放器是最高风险模块
□ 承诺：P0 bug 零容忍，全部修复后才交付  
□ 源项目基线版本：8.1.0
```

**开始执行 → 进入 04-implementation-steps.md 阶段 1**
