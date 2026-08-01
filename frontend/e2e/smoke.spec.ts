import { test, expect } from '@playwright/test'

test('首页加载并显示视频库', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Loc Gallery')).toBeVisible()
  await expect(page.getByTestId('search-input')).toBeVisible()
})

test('分类侧栏可见', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('category-list')).toBeVisible({ timeout: 15000 })
})

test('收藏页导航', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: '我的收藏' }).click()
  await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible()
})
