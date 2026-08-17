/**
 * 设置模块测试（规格 §27）：默认值、合并保存、单位换算与脏数据防御。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'
import {
  DEFAULT_UNITS,
  METERS_PER_MILE,
  PROFILE_KEY,
  UNITS_KEY,
  convertDistance,
  formatDistanceByUnit,
  formatSpeedByUnit,
  getSettings,
  saveSettings,
} from '@/features/settings/settings'

describe('设置读写', () => {
  let db: CyclingDatabase
  let repo: DexieSettingsRepository

  beforeEach(() => {
    db = new CyclingDatabase()
    repo = new DexieSettingsRepository(db)
  })

  afterEach(async () => {
    await db.delete()
  })

  it('空库返回默认设置（公制 km/24h，profile 为空）', async () => {
    const settings = await getSettings(repo)

    expect(settings.profile).toEqual({})
    expect(settings.units).toEqual(DEFAULT_UNITS)
  })

  it('saveSettings 写入完整数据后 getSettings 可读回', async () => {
    await saveSettings(
      {
        profile: { nickname: '晨骑爱好者', weightKg: 70.5, heightCm: 178, ftp: 250, maxHeartRate: 190, restingHeartRate: 55 },
        units: { distance: 'mi', timeFormat: '12h' },
      },
      repo,
    )

    const settings = await getSettings(repo)
    expect(settings.profile).toEqual({
      nickname: '晨骑爱好者',
      weightKg: 70.5,
      heightCm: 178,
      ftp: 250,
      maxHeartRate: 190,
      restingHeartRate: 55,
    })
    expect(settings.units).toEqual({ distance: 'mi', timeFormat: '12h' })
  })

  it('saveSettings 按域合并：只更新 profile 时保留未修改字段', async () => {
    await saveSettings({ profile: { nickname: '晨骑爱好者', ftp: 250 }, units: { distance: 'mi', timeFormat: '12h' } }, repo)

    await saveSettings({ profile: { ftp: 270 } }, repo)

    const settings = await getSettings(repo)
    expect(settings.profile).toEqual({ nickname: '晨骑爱好者', ftp: 270 })
    expect(settings.units).toEqual({ distance: 'mi', timeFormat: '12h' })
  })

  it('saveSettings 按域合并：只更新 units 时 profile 不变', async () => {
    await saveSettings({ profile: { nickname: '晨骑爱好者' }, units: { distance: 'km', timeFormat: '24h' } }, repo)

    await saveSettings({ units: { distance: 'mi' } }, repo)

    const settings = await getSettings(repo)
    expect(settings.profile).toEqual({ nickname: '晨骑爱好者' })
    expect(settings.units).toEqual({ distance: 'mi', timeFormat: '24h' })
  })

  it('saveSettings 传入 undefined 字段会清空旧值', async () => {
    await saveSettings({ profile: { ftp: 250 } }, repo)

    await saveSettings({ profile: { ftp: undefined } }, repo)

    const settings = await getSettings(repo)
    expect(settings.profile).toEqual({})
  })

  it('settings 表存在脏数据（非对象值）时返回默认值', async () => {
    await repo.set(PROFILE_KEY, 'not-an-object')
    await repo.set(UNITS_KEY, 42)

    const settings = await getSettings(repo)
    expect(settings.profile).toEqual({})
    expect(settings.units).toEqual(DEFAULT_UNITS)
  })

  it('导入偏好（§19）：默认不保存原始文件，保存后可读回且不影响其他域', async () => {
    // 默认值
    expect((await getSettings(repo)).import.saveOriginalFit).toBe(false)

    await saveSettings({ units: { distance: 'mi' } }, repo)
    await saveSettings({ import: { saveOriginalFit: true } }, repo)

    const settings = await getSettings(repo)
    expect(settings.import.saveOriginalFit).toBe(true)
    expect(settings.units.distance).toBe('mi')
  })
})

describe('单位换算', () => {
  it('convertDistance：米 → 公里', () => {
    expect(convertDistance(50_000, 'km')).toBe(50)
  })

  it('convertDistance：米 → 英里', () => {
    expect(convertDistance(METERS_PER_MILE, 'mi')).toBe(1)
    expect(convertDistance(50_000, 'mi')).toBeCloseTo(31.0686, 3)
  })

  it('formatDistanceByUnit：公里模式小于 1 km 显示整数米', () => {
    expect(formatDistanceByUnit(850, 'km')).toBe('850 m')
  })

  it('formatDistanceByUnit：公里模式显示 2 位小数千米', () => {
    expect(formatDistanceByUnit(82_310, 'km')).toBe('82.31 km')
  })

  it('formatDistanceByUnit：英里模式显示 2 位小数英里', () => {
    expect(formatDistanceByUnit(50_000, 'mi')).toBe('31.07 mi')
  })

  it('formatDistanceByUnit：无效输入返回占位符', () => {
    expect(formatDistanceByUnit(null, 'km')).toBe('—')
    expect(formatDistanceByUnit(undefined, 'mi')).toBe('—')
    expect(formatDistanceByUnit(Number.NaN, 'km')).toBe('—')
    expect(formatDistanceByUnit(Number.POSITIVE_INFINITY, 'mi')).toBe('—')
  })

  it('formatSpeedByUnit：公里模式显示 km/h', () => {
    expect(formatSpeedByUnit(10, 'km')).toBe('36.0 km/h')
  })

  it('formatSpeedByUnit：英里模式显示 mph', () => {
    // 10 m/s × 2.23694 ≈ 22.4 mph
    expect(formatSpeedByUnit(10, 'mi')).toBe('22.4 mph')
  })

  it('formatSpeedByUnit：无效输入返回占位符', () => {
    expect(formatSpeedByUnit(undefined, 'km')).toBe('—')
    expect(formatSpeedByUnit(Number.NaN, 'mi')).toBe('—')
  })
})
