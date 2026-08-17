/**
 * 数据导出/导入测试（规格 §33）：
 * 真库数据 → 导出结构断言；导出 → 导入新库数据一致；重复导入跳过；
 * 分批读取、解析校验与文件名生成。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Activity, ActivityRecord } from '@/types/activity'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository } from '@/storage/repositories/fileRepository'
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository'
import {
  EXPORT_APP,
  EXPORT_VERSION,
  defaultExportFilename,
  exportData,
  importBundle,
  parseExportBundle,
  type ExportBundle,
} from '@/features/settings/exportImport'
import { PROFILE_KEY } from '@/features/settings/settings'

describe('数据导出', () => {
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

  it('导出 JSON 结构：版本号、导出时间、摘要/逐点/台账/设置齐全', async () => {
    const withRecords = makeActivity('act-1', 'fp-1', {
      records: [makeRecord(1), makeRecord(2), makeRecord(3)],
    })
    const withoutRecords = makeActivity('act-2', 'fp-2')
    await activityRepo.addActivity(withRecords, '晨骑绕圈')
    await activityRepo.addActivity(withoutRecords)
    await fileRepo.recordImported('fp-1', 'ride-1.fit', 1024)
    await settingsRepo.set(PROFILE_KEY, { nickname: '晨骑爱好者', ftp: 250 })
    const now = new Date('2026-08-17T12:00:00.000Z')

    const bundle = await exportData({
      db,
      activityRepository: activityRepo,
      fileRepository: fileRepo,
      settingsRepository: settingsRepo,
      now,
    })

    expect(bundle.app).toBe(EXPORT_APP)
    expect(bundle.version).toBe(EXPORT_VERSION)
    expect(bundle.exportedAt).toBe('2026-08-17T12:00:00.000Z')

    // 活动摘要：不含逐点记录，标题保留
    expect(bundle.activities).toHaveLength(2)
    const first = bundle.activities.find((a) => a.id === 'act-1')
    expect(first).toMatchObject({ id: 'act-1', fingerprint: 'fp-1', name: '晨骑绕圈', distance: 50_000 })
    expect(first).not.toHaveProperty('records')

    // 逐点记录：含 activityId、无自增主键
    expect(bundle.records).toHaveLength(3)
    for (const record of bundle.records) {
      expect(record.activityId).toBe('act-1')
      expect(record).not.toHaveProperty('id')
    }
    expect(bundle.records[0]).toMatchObject({ timestamp: 1, latitude: 39.9 })

    // 台账与设置
    expect(bundle.files).toEqual([
      expect.objectContaining({ fingerprint: 'fp-1', fileName: 'ride-1.fit', fileSize: 1024, status: 'imported' }),
    ])
    expect(bundle.settings).toContainEqual({ key: PROFILE_KEY, value: { nickname: '晨骑爱好者', ftp: 250 } })
  })

  it('台账原始 FIT 字节不进入导出（规格 §19/§33）', async () => {
    await fileRepo.recordImported('fp-1', 'ride-1.fit', 1024, new Uint8Array([1, 2, 3]).buffer)

    const bundle = await exportData({
      db,
      activityRepository: activityRepo,
      fileRepository: fileRepo,
      settingsRepository: settingsRepo,
      now: new Date('2026-08-17T12:00:00.000Z'),
    })

    expect(bundle.files).toHaveLength(1)
    expect(bundle.files[0]).not.toHaveProperty('data')
    // 可 JSON 序列化（ArrayBuffer 会导致内容丢失）
    expect(() => JSON.stringify(bundle)).not.toThrow()
  })

  it('逐点记录分批读取：批大小小于记录数时仍导出全部', async () => {
    const activity = makeActivity('act-1', 'fp-1', {
      records: [makeRecord(1), makeRecord(2), makeRecord(3), makeRecord(4), makeRecord(5)],
    })
    await activityRepo.addActivity(activity)

    const bundle = await exportData({
      db,
      activityRepository: activityRepo,
      fileRepository: fileRepo,
      settingsRepository: settingsRepo,
      recordBatchSize: 2,
      now: new Date('2026-08-17T12:00:00.000Z'),
    })

    expect(bundle.records.map((r) => r.timestamp)).toEqual([1, 2, 3, 4, 5])
  })

  it('空库导出：各数组为空、版本信息齐全', async () => {
    const bundle = await exportData({
      db,
      activityRepository: activityRepo,
      fileRepository: fileRepo,
      settingsRepository: settingsRepo,
      now: new Date('2026-08-17T12:00:00.000Z'),
    })

    expect(bundle.activities).toEqual([])
    expect(bundle.records).toEqual([])
    expect(bundle.files).toEqual([])
    expect(bundle.settings).toEqual([])
  })
})

describe('数据导入', () => {
  let sourceDb: CyclingDatabase
  let targetDb: CyclingDatabase
  let sourceActivityRepo: DexieActivityRepository
  let targetActivityRepo: DexieActivityRepository
  let targetSettingsRepo: DexieSettingsRepository

  beforeEach(() => {
    // 独立库名：fake-indexeddb 按库名共享数据，同名会读到对方的写入
    sourceDb = new CyclingDatabase('settings-export-source')
    targetDb = new CyclingDatabase('settings-export-target')
    sourceActivityRepo = new DexieActivityRepository(sourceDb)
    targetActivityRepo = new DexieActivityRepository(targetDb)
    targetSettingsRepo = new DexieSettingsRepository(targetDb)
  })

  afterEach(async () => {
    await sourceDb.delete()
    await targetDb.delete()
  })

  /**
   * 造源库数据并导出为数据包。
   */
  async function exportSource(): Promise<ExportBundle> {
    await sourceActivityRepo.addActivity(
      makeActivity('act-1', 'fp-1', { records: [makeRecord(1), makeRecord(2)] }),
      '晨骑绕圈',
    )
    await sourceActivityRepo.addActivity(makeActivity('act-2', 'fp-2'))
    await new DexieFileRepository(sourceDb).recordImported('fp-1', 'ride-1.fit', 1024)
    await new DexieSettingsRepository(sourceDb).set(PROFILE_KEY, { nickname: '晨骑爱好者', ftp: 250 })
    return exportData({
      db: sourceDb,
      activityRepository: sourceActivityRepo,
      fileRepository: new DexieFileRepository(sourceDb),
      settingsRepository: new DexieSettingsRepository(sourceDb),
      now: new Date('2026-08-17T12:00:00.000Z'),
    })
  }

  it('导出后再导入到新库：数据一致（含标题、逐点、台账、设置）', async () => {
    const bundle = await exportSource()

    const summary = await importBundle(bundle, {
      db: targetDb,
      activityRepository: targetActivityRepo,
      settingsRepository: targetSettingsRepo,
    })

    expect(summary).toEqual({ newImported: 2, skipped: 0 })

    const activities = await targetActivityRepo.listAllSummaries()
    expect(activities).toHaveLength(2)
    const first = activities.find((a) => a.id === 'act-1')
    expect(first).toMatchObject({ id: 'act-1', fingerprint: 'fp-1', name: '晨骑绕圈', fileName: 'act-1.fit' })
    expect(await targetActivityRepo.getRecords('act-1')).toHaveLength(2)
    expect(await targetActivityRepo.getRecords('act-2')).toHaveLength(0)

    const files = await targetDb.files.toArray()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ fingerprint: 'fp-1', fileName: 'ride-1.fit', fileSize: 1024 })

    const settings = await targetSettingsRepo.get(PROFILE_KEY)
    expect(settings).toEqual({ nickname: '晨骑爱好者', ftp: 250 })
  })

  it('重复导入同一数据包：全部跳过，库数据不变', async () => {
    const bundle = await exportSource()
    await importBundle(bundle, {
      db: targetDb,
      activityRepository: targetActivityRepo,
      settingsRepository: targetSettingsRepo,
    })

    const second = await importBundle(bundle, {
      db: targetDb,
      activityRepository: targetActivityRepo,
      settingsRepository: targetSettingsRepo,
    })

    expect(second).toEqual({ newImported: 0, skipped: 2 })
    expect(await targetActivityRepo.countActivities()).toBe(2)
    expect(await targetDb.activity_records.count()).toBe(2)
  })

  it('部分重复导入：仅新增未导入的活动', async () => {
    const bundle = await exportSource()
    // 目标库预先导入 act-2（同 fingerprint）
    await targetActivityRepo.addActivity(makeActivity('act-2', 'fp-2'))

    const summary = await importBundle(bundle, {
      db: targetDb,
      activityRepository: targetActivityRepo,
      settingsRepository: targetSettingsRepo,
    })

    expect(summary).toEqual({ newImported: 1, skipped: 1 })
    expect(await targetActivityRepo.countActivities()).toBe(2)
    expect(await targetActivityRepo.getRecords('act-1')).toHaveLength(2)
  })

  it('settings 合并：同 key 以导出值覆盖', async () => {
    await targetSettingsRepo.set(PROFILE_KEY, { nickname: '旧昵称' })
    const bundle = await exportSource()

    await importBundle(bundle, {
      db: targetDb,
      activityRepository: targetActivityRepo,
      settingsRepository: targetSettingsRepo,
    })

    expect(await targetSettingsRepo.get(PROFILE_KEY)).toEqual({ nickname: '晨骑爱好者', ftp: 250 })
  })
})

describe('导出文件解析与文件名', () => {
  it('parseExportBundle：合法 JSON 返回数据包', () => {
    const bundle: ExportBundle = {
      app: EXPORT_APP,
      version: EXPORT_VERSION,
      exportedAt: '2026-08-17T12:00:00.000Z',
      activities: [],
      records: [],
      files: [],
      settings: [],
    }

    expect(parseExportBundle(JSON.stringify(bundle))).toEqual(bundle)
  })

  it('parseExportBundle：非法 JSON 抛错', () => {
    expect(() => parseExportBundle('not-json')).toThrow('Invalid JSON format')
  })

  it('parseExportBundle：版本高于当前支持时抛错', () => {
    const text = JSON.stringify({
      app: EXPORT_APP,
      version: EXPORT_VERSION + 1,
      exportedAt: '2026-08-17T12:00:00.000Z',
      activities: [],
      records: [],
      files: [],
      settings: [],
    })

    expect(() => parseExportBundle(text)).toThrow('Unsupported export format')
  })

  it('parseExportBundle：应用标识不符时抛错', () => {
    const text = JSON.stringify({
      app: 'other-app',
      version: EXPORT_VERSION,
      exportedAt: '2026-08-17T12:00:00.000Z',
      activities: [],
      records: [],
      files: [],
      settings: [],
    })

    expect(() => parseExportBundle(text)).toThrow('Unsupported export format')
  })

  it('defaultExportFilename 取导出日期生成文件名', () => {
    expect(defaultExportFilename('2026-08-17T12:00:00.000Z')).toBe('cycling-data-2026-08-17.json')
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

/**
 * 生成测试逐点记录。
 *
 * @param timestamp 时间（Unix 秒）
 */
function makeRecord(timestamp: number): ActivityRecord {
  return { timestamp, latitude: 39.9, longitude: 116.4, altitude: 50, speed: 8.3 }
}
