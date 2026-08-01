# 08 — 测试与验收标准

---

## 1. 测试策略

### 1.1 测试金字塔

```
        ┌─────────┐
        │  E2E    │  Playwright（关键用户流程）
        │  10%    │
        ├─────────┤
        │ 集成测试 │  API + Store（Vitest）
        │  30%    │
        ├─────────┤
        │ 单元测试 │  Composables + Utils（Vitest）
        │  60%    │
        └─────────┘
```

### 1.2 测试工具

| 工具 | 用途 | 配置位置 |
|------|------|----------|
| Vitest | 单元/集成测试 | `frontend/vitest.config.ts` |
| @vue/test-utils | 组件测试 | — |
| Playwright | E2E 测试 | `frontend/playwright.config.ts` |
| pytest | 后端测试（保留源项目） | `backend/tests/` |

---

## 2. 单元测试

### 2.1 API 层测试

```typescript
// tests/api/client.test.ts
describe('api client', () => {
  it('should append library_id to requests', async () => { ... })
  it('should throw ApiError on non-2xx', async () => { ... })
})

// tests/api/videos.test.ts
describe('videos API', () => {
  it('should fetch paginated videos', async () => { ... })
  it('should filter by category', async () => { ... })
  it('should filter favorites', async () => { ... })
})
```

### 2.2 Composables 测试

```typescript
// tests/composables/usePlayback.test.ts
describe('usePlayback', () => {
  it('should select direct mode for standard MP4', async () => { ... })
  it('should select hls mode for large files', async () => { ... })
  it('should abort stale sessions', async () => { ... })
  it('should fallback to hls on direct failure', async () => { ... })
})

// tests/composables/useSSE.test.ts
describe('useSSE', () => {
  it('should reconnect after disconnect', async () => { ... })
  it('should debounce version events', async () => { ... })
})

// tests/composables/useTheme.test.ts
describe('useTheme', () => {
  it('should apply dark theme', () => { ... })
  it('should persist to localStorage', () => { ... })
})
```

### 2.3 Store 测试

```typescript
// tests/stores/gallery.test.ts
describe('gallery store', () => {
  it('should load videos on category change', async () => { ... })
  it('should reset page on search', () => { ... })
})

// tests/stores/player.test.ts
describe('player store', () => {
  it('should increment playSession on switch', () => { ... })
  it('should build playlist from current view', () => { ... })
})
```

### 2.4 工具函数测试

```typescript
// tests/utils/format.test.ts
describe('formatDuration', () => {
  it('should format seconds to mm:ss', () => { ... })
  it('should format hours to h:mm:ss', () => { ... })
})

// tests/utils/sort.test.ts
describe('naturalSort', () => {
  it('should sort filenames naturally', () => { ... })
})
```

---

## 3. 组件测试

### 3.1 关键组件

```typescript
// tests/components/VideoCard.test.ts
describe('VideoCard', () => {
  it('should render thumbnail and title', () => { ... })
  it('should show duration badge', () => { ... })
  it('should toggle favorite on click', async () => { ... })
  it('should show checkbox in manage mode', () => { ... })
})

// tests/components/Pagination.test.ts
describe('Pagination', () => {
  it('should navigate pages', async () => { ... })
  it('should disable prev on first page', () => { ... })
})
```

---

## 4. E2E 测试（Playwright）

### 4.1 测试环境准备

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  baseURL: 'http://127.0.0.1:3457',
  webServer: [
    {
      command: 'cd ../backend && python -m uvicorn loc_gallery.server:app --port 3458',
      port: 3458,
    },
    {
      command: 'npm run dev',
      port: 3457,
    },
  ],
})
```

### 4.2 核心流程测试

```typescript
// e2e/gallery.spec.ts
test.describe('Gallery Browse', () => {
  test('should load categories and videos', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="category-list"]')).toBeVisible()
    await page.locator('[data-testid="category-item"]').first().click()
    await expect(page.locator('[data-testid="video-card"]').first()).toBeVisible()
  })

  test('should search videos', async ({ page }) => {
    await page.goto('/')
    await page.fill('[data-testid="search-input"]', 'test')
    await page.waitForTimeout(500) // debounce
    // verify filtered results
  })

  test('should paginate', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="category-item"]').first().click()
    await page.click('[data-testid="next-page"]')
    // verify page changed
  })
})

// e2e/random.spec.ts（8.1.0）
test.describe('Random Play', () => {
  test('should play random video from toolbar', async ({ page }) => { ... })
  test('should keep random order with seed on refresh', async ({ page }) => { ... })
})

// e2e/player.spec.ts
test.describe('Video Player', () => {
  test('should play video on card click', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="category-item"]').first().click()
    await page.locator('[data-testid="video-card"]').first().click()
    await expect(page.locator('[data-testid="player-view"]')).toBeVisible()
    await expect(page.locator('video')).toBeVisible()
  })

  test('should close player on escape', async ({ page }) => {
    // open player, press Escape, verify closed
  })
})

// e2e/favorites.spec.ts
test.describe('Favorites', () => {
  test('should toggle favorite', async ({ page }) => { ... })
  test('should show favorites view', async ({ page }) => { ... })
})

// e2e/settings.spec.ts
test.describe('Settings', () => {
  test('should open settings dialog', async ({ page }) => { ... })
  test('should save settings', async ({ page }) => { ... })
  test('should switch theme', async ({ page }) => { ... })
})
```

### 4.3 测试数据要求

E2E 测试需要后端有可用测试数据：
- 至少 1 个视频库
- 至少 2 个分类
- 至少 5 个视频文件
- 建议软链源项目 `data/` 目录

---

## 5. 后端测试（保留）

源项目已有 6 个测试文件，复制后应全部通过：

```powershell
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m pytest tests/ -v
```

| 测试文件 | 验证内容 |
|----------|----------|
| test_album_store.py | 专辑存储 CRUD |
| test_album_api.py | 专辑 API 端点 |
| test_multi_library.py | 多库数据隔离 |
| test_disguised_pipe.py | 伪装 TS 格式识别 |
| test_auto_new_video.py | 新视频自动索引 |
| test_file_stability.py | 文件稳定检测 |

---

## 6. 验收流程

### 6.1 阶段验收（每阶段结束时）

```
1. 运行该阶段相关单元测试 → 全部通过
2. 运行该阶段相关 E2E 测试 → 全部通过
3. 对照 06-feature-checklist.md 勾选该阶段功能项
4. 手动冒烟测试（见 6.2）
5. 记录问题到 issues，P0 必须修复后才能进入下一阶段
```

### 6.2 手动冒烟测试清单

每次阶段验收时执行：

| # | 操作 | 预期 |
|---|------|------|
| 1 | 打开首页 | 分类侧栏显示，无 JS 错误 |
| 2 | 点击分类 | 视频网格加载，缩略图显示 |
| 3 | 搜索关键词 | 结果过滤正确 |
| 4 | 翻页 | 下一页视频不同 |
| 5 | 点击视频播放 | 播放器打开，视频播放 |
| 6 | 关闭播放器 | 回到网格，无残留 |
| 7 | 切换收藏 | ♥ 状态切换 |
| 8 | 打开设置 | 对话框显示，设置可保存 |
| 9 | 切换主题 | 界面颜色变化 |
| 10 | 控制台 | 无 error 级别日志 |

### 6.3 最终验收（M8）

```
1. 06-feature-checklist.md 112/112 全部勾选
2. 所有单元测试通过（npm run test）
3. 所有 E2E 测试通过（npx playwright test）
4. 所有后端测试通过（pytest）
5. 生产构建成功（npm run build）
6. restart.py 一键启动正常
7. 手动冒烟测试 10 项全部通过
8. 零已知 bug
9. 确认未执行任何远程 git 操作
10. 确认 F:\Loc-Gallery 未被修改
```

---

## 7. 回归测试矩阵

| 功能域 | 单元 | 组件 | E2E | 手动 |
|--------|------|------|-----|------|
| 画廊浏览 | ✓ | ✓ | ✓ | ✓ |
| 播放器 direct | ✓ | — | ✓ | ✓ |
| 播放器 HLS | ✓ | — | ✓ | ✓ |
| 播放器 remux | — | — | — | ✓ |
| 收藏 | ✓ | ✓ | ✓ | ✓ |
| 历史 | ✓ | — | ✓ | ✓ |
| 专辑 | ✓ | ✓ | ✓ | ✓ |
| 批量操作 | — | ✓ | — | ✓ |
| 设置 | ✓ | ✓ | ✓ | ✓ |
| 主题 | ✓ | — | ✓ | ✓ |
| SSE | ✓ | — | — | ✓ |
| 多库 | ✓ | — | — | ✓ |

---

## 8. Bug 优先级定义

| 级别 | 定义 | 处理 |
|------|------|------|
| P0 | 崩溃、数据丢失、无法播放、无法启动 | 立即修复，阻塞交付 |
| P1 | 功能不可用、UI 严重破损、性能严重下降 | 交付前修复 |
| P2 | 样式瑕疵、次要功能缺失、体验不佳 | 记录 issue，可后续修复 |
| P3 | 优化建议、代码质量 | 记录 backlog |

---

## 9. 性能基准

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 首页加载（分类） | < 1s | Performance API |
| 视频网格渲染（40 条） | < 500ms | Performance API |
| 翻页响应 | < 500ms | 手动计时 |
| 播放器起播（direct） | < 2s | 手动计时 |
| 播放器起播（HLS） | < 5s | 手动计时 |
| 搜索响应 | < 300ms | debounce 后计时 |
| 主题切换 | < 100ms | 无闪烁 |
| 内存占用（1000 视频库） | < 200MB | Chrome DevTools |

---

## 10. 测试命令速查

```powershell
# 前端单元测试
cd F:\Loc-Gallery-Vue\frontend
npm run test

# 前端 E2E 测试
npx playwright test

# 前端 E2E 带 UI
npx playwright test --ui

# 后端测试
cd F:\Loc-Gallery-Vue\backend
$env:PYTHONPATH = "src"
python -m pytest tests/ -v

# 类型检查
cd F:\Loc-Gallery-Vue\frontend
npx vue-tsc --noEmit

# Lint
npm run lint
```
