/**
 * 赛段扫描状态测试（赛段页进入提速）。
 *
 * 纯函数部分：构造状态与 diff（决定本次是全量扫 / 增量扫 / 不扫）。
 * 持久化部分：经 scan_cache 往返，验证结构版本失配自动失效。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/storage/db'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { SegmentEntity } from '@/storage/db'
import {
  SEGMENT_SCAN_CACHE_NAME,
  SEGMENT_SCAN_STATE_VERSION,
  buildSegmentScanState,
  clearSegmentScanState,
  diffSegmentScanState,
  loadSegmentScanState,
  pruneSegmentScanState,
  saveSegmentScanState,
} from '@/storage/segmentScanState'

beforeEach(async () => {
  await db.scan_cache.clear()
})

/** 构造活动摘要（只含 id 与影响匹配的坐标字段） */
function makeSummary(id: string, system = '', north = 0, east = 0): ActivitySummary {
  return {
    id,
    startTime: '2026-08-01T08:00:00',
    distance: 1000,
    activityType: 'cycling',
    coordinateSystem: system === '' ? undefined : (system as ActivitySummary['coordinateSystem']),
    trackOffset: { northMeters: north, eastMeters: east },
  } as ActivitySummary
}

/** 构造赛段实体（只含 id） */
function makeSegment(id: number): SegmentEntity {
  return { id, name: `s-${id}` } as SegmentEntity
}

describe('diffSegmentScanState', () => {
  it('无历史状态时全量扫（首次进入）', () => {
    const current = buildSegmentScanState([makeSegment(1)], [makeSummary('act-1')])

    const diff = diffSegmentScanState(null, current)

    expect(diff).toEqual({ needsScan: true, fullRescan: true, activityIds: ['act-1'] })
  })

  it('数据完全未变时不需要扫描', () => {
    const segments = [makeSegment(1), makeSegment(2)]
    const summaries = [makeSummary('act-1'), makeSummary('act-2')]
    const previous = buildSegmentScanState(segments, summaries)

    const diff = diffSegmentScanState(previous, buildSegmentScanState(segments, summaries))

    expect(diff.needsScan).toBe(false)
    expect(diff.activityIds).toEqual([])
  })

  it('新增赛段触发全量扫（新赛段缺全部活动成绩）', () => {
    const summaries = [makeSummary('act-1'), makeSummary('act-2')]
    const previous = buildSegmentScanState([makeSegment(1)], summaries)

    const diff = diffSegmentScanState(
      previous,
      buildSegmentScanState([makeSegment(1), makeSegment(9)], summaries),
    )

    expect(diff.needsScan).toBe(true)
    expect(diff.fullRescan).toBe(true)
    expect(diff.activityIds).toEqual(['act-1', 'act-2'])
  })

  it('只新增活动时只扫该活动（增量）', () => {
    const segments = [makeSegment(1)]
    const previous = buildSegmentScanState(segments, [makeSummary('act-1')])
    const current = buildSegmentScanState(segments, [makeSummary('act-1'), makeSummary('act-2')])

    const diff = diffSegmentScanState(previous, current)

    expect(diff.needsScan).toBe(true)
    expect(diff.fullRescan).toBe(false)
    expect(diff.activityIds).toEqual(['act-2'])
  })

  it('活动纠偏后只扫被纠偏的活动', () => {
    const segments = [makeSegment(1)]
    const previous = buildSegmentScanState(segments, [
      makeSummary('act-1'),
      makeSummary('act-2'),
    ])
    const current = buildSegmentScanState(segments, [
      makeSummary('act-1'),
      makeSummary('act-2', 'wgs84', 12, -3),
    ])

    const diff = diffSegmentScanState(previous, current)

    expect(diff.fullRescan).toBe(false)
    expect(diff.activityIds).toEqual(['act-2'])
  })

  it('删除活动不触发扫描（其成绩已级联删除）', () => {
    const segments = [makeSegment(1)]
    const previous = buildSegmentScanState(segments, [makeSummary('act-1'), makeSummary('act-2')])

    const diff = diffSegmentScanState(previous, buildSegmentScanState(segments, [makeSummary('act-1')]))

    expect(diff.needsScan).toBe(false)
  })
})

describe('扫描状态持久化', () => {
  it('写入后可原样读出（跨会话复用）', async () => {
    expect(await loadSegmentScanState()).toBeNull()

    const state = buildSegmentScanState([makeSegment(1)], [makeSummary('act-1')])
    await saveSegmentScanState(state)

    expect(await loadSegmentScanState()).toEqual(state)
  })

  it('结构版本失配时旧记录失效（按 fingerprint 自动清除）', async () => {
    await db.scan_cache.put({
      name: SEGMENT_SCAN_CACHE_NAME,
      fingerprint: 'v0-旧结构',
      payload: { segmentIds: [1], activityStates: { 'act-1': '|0,0' } },
    })

    expect(await loadSegmentScanState()).toBeNull()
    expect(await db.scan_cache.get(SEGMENT_SCAN_CACHE_NAME)).toBeUndefined()
  })

  it('pruneSegmentScanState 剔除已删除活动（重新导入可再次触发扫描）', async () => {
    await saveSegmentScanState(
      buildSegmentScanState([makeSegment(1)], [makeSummary('act-1'), makeSummary('act-2')]),
    )

    await pruneSegmentScanState(['act-2'])

    const state = await loadSegmentScanState()
    expect(Object.keys(state?.activityStates ?? {})).toEqual(['act-1'])
    // act-2 重新导入：视为新增活动，增量扫描会扫到它
    const diff = diffSegmentScanState(
      state,
      buildSegmentScanState([makeSegment(1)], [makeSummary('act-1'), makeSummary('act-2')]),
    )
    expect(diff.activityIds).toEqual(['act-2'])
  })

  it('clearSegmentScanState 复位为空状态（按首次进入处理）', async () => {
    await saveSegmentScanState(buildSegmentScanState([makeSegment(1)], [makeSummary('act-1')]))

    await clearSegmentScanState()

    expect(await loadSegmentScanState()).toEqual({ segmentIds: [], activityStates: {} })
  })

  it('写入的 fingerprint 为当前结构版本', async () => {
    await saveSegmentScanState(buildSegmentScanState([makeSegment(1)], [makeSummary('act-1')]))

    const entry = await db.scan_cache.get(SEGMENT_SCAN_CACHE_NAME)
    expect(entry?.fingerprint).toBe(SEGMENT_SCAN_STATE_VERSION)
  })
})
