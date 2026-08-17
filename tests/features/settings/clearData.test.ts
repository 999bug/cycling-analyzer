/**
 * 清空全部本地数据测试（规格 §32）：activities/records/files/settings 全部清空。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Activity } from '@/types/activity'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository } from '@/storage/repositories/fileRepository'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'
import { clearAllData } from '@/features/settings/dataClear'
import { DEFAULT_APPEARANCE, DEFAULT_IMPORT, DEFAULT_UNITS, getSettings, saveSettings } from '@/features/settings/settings'

describe('clearAllData', () => {
  let db: CyclingDatabase
  let activityRepo: DexieActivityRepository
  let fileRepo: DexieFileRepository
  let settingsRepo: DexieSettingsRepository

  beforeEach(() => {
    db = new CyclingDatabase()
    activityRepo = new DexieActivityRepository(db)
    fileRepo = new DexieFileRepository(db)
    settingsRepo = new DexieSettingsRepository(db)
  })

  afterEach(async () => {
    await db.delete()
  })

  it('清空活动摘要、逐点记录、文件台账与设置', async () => {
    await activityRepo.addActivity(makeActivity('act-1', 'fp-1', { records: [{ timestamp: 1 }] }))
    await activityRepo.addActivity(makeActivity('act-2', 'fp-2'))
    await fileRepo.recordImported('fp-1', 'ride-1.fit', 1024)
    await saveSettings({ profile: { nickname: '晨骑爱好者' }, units: { distance: 'mi' } }, settingsRepo)

    await clearAllData({ db, activityRepository: activityRepo, fileRepository: fileRepo })

    expect(await activityRepo.countActivities()).toBe(0)
    expect(await db.activity_records.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    // settings 一并清空：读回默认值（规格 §27 默认公制）
    const settings = await getSettings(settingsRepo)
    expect(settings.profile).toEqual({})
    expect(settings.units).toEqual(DEFAULT_UNITS)
  })

  it('空库清空不报错', async () => {
    await clearAllData({ db, activityRepository: activityRepo, fileRepository: fileRepo })

    expect(await activityRepo.countActivities()).toBe(0)
    // 读回各域默认值（规格 §27 默认公制 + §36 默认深色主题 + §19 默认不保存原始文件）
    expect(await getSettings(settingsRepo)).toEqual({
      profile: {},
      units: DEFAULT_UNITS,
      appearance: DEFAULT_APPEARANCE,
      import: DEFAULT_IMPORT,
    })
  })
})

/**
 * 生成测试活动。
 *
 * @param id 活动 ID
 * @param fingerprint 文件指纹
 * @param overrides 覆盖默认字段（可选 records）
 */
function makeActivity(id: string, fingerprint: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint,
    activityType: 'cycling',
    startTime: '2026-08-17T08:00:00.000Z',
    endTime: '2026-08-17T09:30:00.000Z',
    duration: 5400,
    elapsedTime: 5400,
    distance: 50_000,
    elevationGain: 300,
    ...overrides,
  }
}
