import { expect, test } from '@playwright/test'

test.describe('应用基础链路', () => {
  test('首页加载并可导航到骑行记录', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('main#main-content')).toBeVisible()
    await expect(page.getByRole('link', { name: '骑行记录' })).toBeVisible()

    await page.getByRole('link', { name: '骑行记录' }).click()
    await expect(page).toHaveURL(/\/activities$/)
    await expect(page.getByRole('heading', { name: '骑行记录' })).toBeVisible()
  })

  test('直接访问深链接后仍能渲染对应页面', async ({ page }) => {
    await page.goto('/calendar')

    await expect(page).toHaveURL(/\/calendar$/)
    await expect(page.getByRole('heading', { name: '日历' })).toBeVisible()
  })
})
