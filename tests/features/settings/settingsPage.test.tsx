/**
 * 设置页集成测试（规格 §27/§32/§33）。
 * 通过 vi.mock 注入独立数据库实例 + fake-indexeddb：
 * 验证默认公制渲染、保存回填、导出下载、导入汇总与清空（二次确认）。
 */
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'
import SettingsPage from '@/pages/SettingsPage'
import {
  EXPORT_APP,
  EXPORT_VERSION,
  type ExportBundle,
} from '@/features/settings/exportImport'
import { getSettings, saveSettings } from '@/features/settings/settings'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import type { Activity } from '@/types/activity'

// 页面使用全局 db 单例：mock 模块导出独立的测试数据库实例（文件内共享）
vi.mock('@/storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/db')>()
  return { ...actual, db: new actual.CyclingDatabase() }
})

/** 测试数据库实例（vi.mock 注入，页面与测试共享） */
const testDb = db

beforeEach(async () => {
  // 清空各表而非删除数据库：vi.mock 共享单实例，delete() 后实例不可复用
  await testDb.activities.clear()
  await testDb.activity_records.clear()
  await testDb.files.clear()
  await testDb.settings.clear()
  // 数据源复位（「关于」区块作者名依赖 store）
  localStorage.clear()
  useDataSourceStore.setState({ source: 'author', authorAvailable: false, authorName: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('设置页', () => {
  const user = userEvent.setup()

  beforeAll(() => {
    // jsdom 未实现 Blob URL API：注入 stub 验证导出下载流程
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('空库渲染默认公制表单（距离公里、时间 24 小时制）', async () => {
    render(<SettingsPage />)

    expect(await screen.findByLabelText('昵称')).toHaveValue('')
    expect(screen.getByLabelText('体重')).toHaveValue(null)
    expect(screen.getByLabelText('距离')).toHaveValue('km')
    expect(screen.getByLabelText('时间格式')).toHaveValue('24h')
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出数据' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入数据' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空全部本地数据' })).toBeInTheDocument()
  })

  it('「关于」区块说明作者数据与本地隐私（含作者名）', async () => {
    useDataSourceStore.setState({ authorName: 'Saul' })
    render(<SettingsPage />)

    const about = screen.getByRole('region', { name: '关于' })
    expect(about).toHaveTextContent('Saul')
    expect(about).toHaveTextContent('只读')
    expect(about).toHaveTextContent('不会上传')
    // 两处数据源提示文案
    expect(screen.getByText(/训练配置仅作用于「我的数据」/)).toBeInTheDocument()
    expect(screen.getByText(/导出\/清空仅作用于「我的数据」/)).toBeInTheDocument()
  })

  it('预置设置后渲染回填（昵称/体重/英里/12 小时制）', async () => {
    const settingsRepo = new DexieSettingsRepository(testDb)
    await saveSettings(
      {
        profile: { nickname: '晨骑爱好者', weightKg: 70.5, ftp: 250 },
        units: { distance: 'mi', timeFormat: '12h' },
      },
      settingsRepo,
    )

    render(<SettingsPage />)

    // 回填为异步加载，等待表单值就绪
    await waitFor(() => {
      expect(screen.getByLabelText('昵称')).toHaveValue('晨骑爱好者')
    })
    expect(screen.getByLabelText('体重')).toHaveValue(70.5)
    expect(screen.getByLabelText('FTP')).toHaveValue(250)
    expect(screen.getByLabelText('距离')).toHaveValue('mi')
    expect(screen.getByLabelText('时间格式')).toHaveValue('12h')
  })

  it('编辑表单保存：提示成功且库中值正确（合并保存不丢字段）', async () => {
    const settingsRepo = new DexieSettingsRepository(testDb)
    await saveSettings({ profile: { nickname: '旧昵称' } }, settingsRepo)

    render(<SettingsPage />)
    // 等待回填完成后再编辑，避免异步回填覆盖输入
    const nickname = await screen.findByLabelText('昵称')
    await waitFor(() => {
      expect(nickname).toHaveValue('旧昵称')
    })
    await user.clear(nickname)
    await user.type(nickname, '晨骑爱好者')
    await user.type(screen.getByLabelText('体重'), '70')
    await user.type(screen.getByLabelText('FTP'), '250')
    await user.selectOptions(screen.getByLabelText('距离'), 'mi')
    await user.click(screen.getByRole('button', { name: '保存设置' }))

    expect(await screen.findByText('设置已保存')).toBeInTheDocument()
    const settings = await getSettings(settingsRepo)
    expect(settings.profile).toEqual({ nickname: '晨骑爱好者', weightKg: 70, ftp: 250 })
    expect(settings.units).toEqual({ distance: 'mi', timeFormat: '24h' })
  })

  it('导出数据：触发浏览器下载并提示文件名', async () => {
    const activityRepo = new DexieActivityRepository(testDb)
    await activityRepo.addActivity(makeActivity('act-1', 'fp-1'))

    render(<SettingsPage />)
    await user.click(await screen.findByRole('button', { name: '导出数据' }))

    expect(await screen.findByText(/^数据已导出：/)).toBeInTheDocument()
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('导入数据：文件上传后提示汇总，活动与设置落入库中', async () => {
    const bundle: ExportBundle = {
      app: EXPORT_APP,
      version: EXPORT_VERSION,
      exportedAt: '2026-08-17T12:00:00.000Z',
      activities: [
        makeActivity('act-1', 'fp-1'),
        makeActivity('act-2', 'fp-2'),
        makeActivity('act-3', 'fp-3'),
      ],
      records: [{ timestamp: 1, activityId: 'act-1' }],
      files: [],
      settings: [{ key: 'profile', value: { nickname: '晨骑爱好者' } }],
    }
    const file = new File([JSON.stringify(bundle)], 'backup.json', { type: 'application/json' })

    render(<SettingsPage />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    expect(await screen.findByText('导入完成：新增 3 条，跳过 0 条')).toBeInTheDocument()
    const activityRepo = new DexieActivityRepository(testDb)
    expect(await activityRepo.countActivities()).toBe(3)
    expect(await activityRepo.getRecords('act-1')).toHaveLength(1)
    const settingsRepo = new DexieSettingsRepository(testDb)
    expect(await settingsRepo.get('profile')).toEqual({ nickname: '晨骑爱好者' })
  })

  it('导入无效文件：提示导入失败', async () => {
    const file = new File(['not-json'], 'backup.json', { type: 'application/json' })

    render(<SettingsPage />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    expect(await screen.findByText(/导入失败：/)).toBeInTheDocument()
  })

  it('清空全部本地数据：二次确认后清空活动与设置，表单重置为默认', async () => {
    const activityRepo = new DexieActivityRepository(testDb)
    await activityRepo.addActivity(makeActivity('act-1', 'fp-1', { records: [{ timestamp: 1 }] }))
    const settingsRepo = new DexieSettingsRepository(testDb)
    await saveSettings({ profile: { nickname: '晨骑爱好者' }, units: { distance: 'mi' } }, settingsRepo)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<SettingsPage />)
    await user.click(await screen.findByRole('button', { name: '清空全部本地数据' }))

    expect(window.confirm).toHaveBeenCalledWith('确定清空全部本地数据？此操作不可恢复')
    expect(await screen.findByText('已清空全部本地数据')).toBeInTheDocument()
    await waitFor(async () => {
      expect(await activityRepo.countActivities()).toBe(0)
    })
    expect(await testDb.activity_records.count()).toBe(0)
    const settings = await getSettings(settingsRepo)
    expect(settings.profile).toEqual({})
    expect(settings.units).toEqual({ distance: 'km', timeFormat: '24h' })
    expect(screen.getByLabelText('距离')).toHaveValue('km')
  })

  it('清空取消确认时不执行任何操作', async () => {
    const activityRepo = new DexieActivityRepository(testDb)
    await activityRepo.addActivity(makeActivity('act-1', 'fp-1'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<SettingsPage />)
    await user.click(await screen.findByRole('button', { name: '清空全部本地数据' }))

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled()
    })
    expect(await activityRepo.countActivities()).toBe(1)
  })
})

/**
 * 生成测试活动（摘要字段完整，供导出/导入使用）。
 *
 * @param id 活动 ID
 * @param fingerprint 文件指纹
 * @param overrides 覆盖默认字段
 */
function makeActivity(id: string, fingerprint: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint,
    activityType: 'cycling',
    startTime: '2026-08-17T08:00:00.000Z',
    endTime: '2026-08-17T09:00:00.000Z',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30_000,
    elevationGain: 200,
    ...overrides,
  }
}

describe('设置页主题切换（规格 §36）', () => {
  const user = userEvent.setup()

  it('默认渲染深色主题选项', async () => {
    render(<SettingsPage />)

    expect(await screen.findByLabelText('主题')).toHaveValue('dark')
  })

  it('切换浅色主题：立即应用并持久化', async () => {
    render(<SettingsPage />)
    const select = await screen.findByLabelText('主题')

    await user.selectOptions(select, 'light')

    expect(await screen.findByText('已切换为浅色主题')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
    const settings = await getSettings()
    expect(settings.appearance.theme).toBe('light')

    // 清理：避免 jsdom 文档状态泄漏到本文件其他用例
    delete document.documentElement.dataset.theme
  })

  it('预置浅色主题后渲染回填', async () => {
    await saveSettings({ appearance: { theme: 'light' } })
    render(<SettingsPage />)

    // 设置异步加载后回填，等待值更新（避免与初始 dark 竞态）
    const select = await screen.findByLabelText('主题')
    await waitFor(() => expect(select).toHaveValue('light'))
  })
})

describe('设置页原始 FIT 文件开关（规格 §19）', () => {
  const user = userEvent.setup()

  it('默认未勾选，开启后立即持久化', async () => {
    render(<SettingsPage />)

    const checkbox = await screen.findByRole('checkbox', { name: '保存原始 FIT 文件' })
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)

    expect(await screen.findByText(/已开启/)).toBeInTheDocument()
    const settings = await getSettings()
    expect(settings.import.saveOriginalFit).toBe(true)
  })
})
