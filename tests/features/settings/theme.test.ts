/**
 * 主题切换测试（规格 §36）。
 *
 * applyTheme 写 <html> data-theme 属性；switchTheme 立即应用并持久化；
 * initTheme 启动时恢复持久化主题。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'
import { getSettings, saveSettings } from '@/features/settings/settings'
import { applyTheme, initTheme, switchTheme } from '@/features/settings/theme'

// 默认仓库使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，测试与默认仓库共享） */
const testDb = db

beforeEach(async () => {
  await testDb.settings.clear()
  delete document.documentElement.dataset.theme
})

describe('主题切换', () => {
  it('applyTheme 写入文档根元素 data-theme', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switchTheme 立即应用并持久化', async () => {
    await switchTheme('light')

    expect(document.documentElement.dataset.theme).toBe('light')
    const settings = await getSettings()
    expect(settings.appearance.theme).toBe('light')
  })

  it('initTheme 恢复持久化主题；无设置时应用默认深色', async () => {
    // 无设置：默认深色
    await initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    // 持久化浅色后恢复
    await saveSettings({ appearance: { theme: 'light' } })
    document.documentElement.dataset.theme = 'dark'
    await initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('外观域按域合并保存，不影响单位偏好', async () => {
    const repo = new DexieSettingsRepository(testDb)
    await saveSettings({ units: { distance: 'mi' } }, repo)
    await saveSettings({ appearance: { theme: 'light' } }, repo)

    const settings = await getSettings(repo)
    expect(settings.units.distance).toBe('mi')
    expect(settings.appearance.theme).toBe('light')
  })
})
