/**
 * 性能压测（规格 §44）。
 *
 * 目标口径：
 * - 单个普通 FIT 文件解析 < 3 秒
 * - 1000 个 Activity 时列表/聚合仍可用
 * - 图表/地图不得全量渲染几十万原始点（功率曲线、轨迹抽稀为线性复杂度）
 *
 * 断言取宽松上限（CI 性能方差大）：验证量级而非精确基准，
 * 防止意外引入 O(n²) 或全表扫描级回归。
 */
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { parseFitBytes } from '@/fit/worker/parseTask'
import { computeFingerprint } from '@/utils/fingerprint'
import { buildDashboardData } from '@/features/dashboard/statistics'
import { buildCalendarData } from '@/features/calendar/calendarData'
import { buildDeviceStats } from '@/features/statistics/deviceStats'
import { buildPowerCurve } from '@/features/analysis/powerCurve'
import { simplifyRoute } from '@/map/simplify'
import type { Activity, ActivityRecord } from '@/types/activity'
import { readFixtureBytes } from '../helpers/fixtures'

/** 压测活动数量（规格 §44：1000 个 Activity 列表可用） */
const ACTIVITY_COUNT = 1000

/** 每个活动的逐点记录数 */
const RECORDS_PER_ACTIVITY = 100

/** 列表分页查询宽松上限（毫秒） */
const LIST_QUERY_BUDGET_MS = 1000

/** 全量摘要聚合纯函数宽松上限（毫秒） */
const AGGREGATE_BUDGET_MS = 1000

/** 单 FIT 解析上限（毫秒，规格 §44 原文 3 秒） */
const PARSE_BUDGET_MS = 3000

/** 大数据量纯函数宽松上限（毫秒） */
const HEAVY_PURE_BUDGET_MS = 2000

/** 大数据量点数（功率曲线/轨迹抽稀） */
const HEAVY_RECORD_COUNT = 50_000

/** 测试数据库实例（本文件独立，beforeAll 一次性灌库） */
const perfDb = new CyclingDatabase()

/**
 * 计时辅助：执行同步函数并返回耗时（毫秒）。
 *
 * @param fn 待测函数
 * @returns [函数返回值, 耗时毫秒]
 */
function timed<T>(fn: () => T): [T, number] {
  const start = performance.now()
  const value = fn()
  return [value, performance.now() - start]
}

/**
 * 构造压测活动：开始时间在两年内均匀分布，带少量逐点记录。
 *
 * @param index 序号（决定 ID/指纹/时间）
 * @returns 活动（含 100 点记录）
 */
function makePerfActivity(index: number): Activity {
  const startMs = Date.now() - (index % 730) * 24 * 60 * 60 * 1000 - index * 60_000
  const startTime = new Date(startMs).toISOString()
  const records: ActivityRecord[] = Array.from({ length: RECORDS_PER_ACTIVITY }, (_, k) => ({
    timestamp: Math.floor(startMs / 1000) + k * 10,
    latitude: 31.2 + k * 0.0001,
    longitude: 121.5 + k * 0.0001,
    power: 180 + (k % 40),
    heartRate: 130 + (k % 30),
  }))
  return {
    id: `perf-${index}`,
    fileId: `file-${index}`,
    fileName: `ride-${index}.fit`,
    fingerprint: `fp-${index}`,
    activityType: 'cycling',
    startTime,
    endTime: startTime,
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000 + (index % 50) * 1000,
    elevationGain: 100 + (index % 200),
    avgSpeed: 8.3,
    avgPower: 200,
    device: { productName: `Edge ${(index % 3) + 1}` },
    records,
  }
}

describe('性能压测（规格 §44）', () => {
  let repository: DexieActivityRepository

  beforeAll(async () => {
    repository = new DexieActivityRepository(perfDb)
    // 一次性灌入 1000 活动 × 100 逐点（10 万行），验证大数据量下的查询/聚合
    const activities = Array.from({ length: ACTIVITY_COUNT }, (_, index) => makePerfActivity(index))
    await repository.addActivities(activities)
  }, 120_000)

  afterAll(async () => {
    await perfDb.delete()
  })

  it('1000 活动：列表分页查询在预算内', async () => {
    const start = performance.now()
    const page = await repository.listActivities({
      sortBy: 'startTime',
      sortOrder: 'desc',
      offset: 500,
      limit: 20,
    })
    const elapsed = performance.now() - start

    expect(page.total).toBe(ACTIVITY_COUNT)
    expect(page.items).toHaveLength(20)
    expect(elapsed).toBeLessThan(LIST_QUERY_BUDGET_MS)
  })

  it('1000 活动：列表筛选（月份 + 数值条件）在预算内', async () => {
    const month = new Date().toISOString().slice(0, 7)
    const start = performance.now()
    const result = await repository.listActivities({
      month,
      minDistance: 40_000,
      minAvgPower: 100,
      limit: 20,
    })
    const elapsed = performance.now() - start

    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(elapsed).toBeLessThan(LIST_QUERY_BUDGET_MS)
  })

  it('1000 活动：Dashboard/日历/设备聚合纯函数在预算内', async () => {
    const summaries = await repository.listAllSummaries()
    expect(summaries).toHaveLength(ACTIVITY_COUNT)

    const [dashboard, dashboardMs] = timed(() => buildDashboardData(summaries))
    const [calendar, calendarMs] = timed(() => buildCalendarData(summaries))
    const [devices, devicesMs] = timed(() => buildDeviceStats(summaries))

    expect(dashboard.hasData).toBe(true)
    expect(calendar.size).toBeGreaterThan(0)
    expect(devices.length).toBeGreaterThan(0)
    expect(dashboardMs).toBeLessThan(AGGREGATE_BUDGET_MS)
    expect(calendarMs).toBeLessThan(AGGREGATE_BUDGET_MS)
    expect(devicesMs).toBeLessThan(AGGREGATE_BUDGET_MS)
  })

  it('单个普通 FIT 文件解析 < 3 秒', async () => {
    const bytes = readFixtureBytes('cycling-gps.fit')
    const fingerprint = await computeFingerprint(bytes)

    const start = performance.now()
    const activity = await parseFitBytes({ fileName: 'cycling-gps.fit', bytes, fingerprint })
    const elapsed = performance.now() - start

    expect(activity.distance).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(PARSE_BUDGET_MS)
  })

  it('5 万逐点：功率曲线计算在线性预算内', () => {
    const records: ActivityRecord[] = Array.from({ length: HEAVY_RECORD_COUNT }, (_, k) => ({
      timestamp: k,
      power: 150 + (k % 120),
    }))

    const [curve, elapsed] = timed(() => buildPowerCurve(records))

    expect(curve.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(HEAVY_PURE_BUDGET_MS)
  })

  it('5 万逐点：轨迹抽稀在线性预算内', () => {
    const records: ActivityRecord[] = Array.from({ length: HEAVY_RECORD_COUNT }, (_, k) => ({
      timestamp: k,
      latitude: 31.2 + k * 0.00001,
      longitude: 121.5 + Math.sin(k / 1000) * 0.01,
    }))

    const [route, elapsed] = timed(() => simplifyRoute(records, 5))

    expect(route.length).toBeGreaterThan(1)
    expect(route.length).toBeLessThan(HEAVY_RECORD_COUNT)
    expect(elapsed).toBeLessThan(HEAVY_PURE_BUDGET_MS)
  })
})
