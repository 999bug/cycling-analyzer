/**
 * Strava 赛段导入纯函数测试。
 *
 * mock 全局 fetch 验证分页拉取 / explore 参数 / 错误传播；
 * 纯函数验证坐标映射、stravaId 去重、bounds 推算。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchExploreSegments,
  fetchStarredSegments,
  filterNewSegments,
  mapStravaSegment,
  trackBounds,
  type StravaSegmentSummary,
} from '@/features/segments/stravaSegments'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 构造 fetch JSON 响应 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    json: async () => body,
  } as Response
}

/** trackBounds 只关心 GPS 字段，测试输入用最小结构 */
type BoundsPoint = { latitude?: number; longitude?: number }

describe('trackBounds', () => {
  it('由逐点推算南北西东角，忽略缺 GPS 的点', () => {
    const bounds = trackBounds([
      { latitude: 31.2, longitude: 121.4 },
      {} as BoundsPoint,
      { latitude: 31.0, longitude: 121.6 },
      { latitude: 31.3, longitude: 121.5 },
    ])
    expect(bounds).toEqual({ south: 31.0, west: 121.4, north: 31.3, east: 121.6 })
  })

  it('全部无 GPS 时返回 undefined', () => {
    expect(trackBounds([{} as BoundsPoint, {} as BoundsPoint])).toBeUndefined()
  })
})

describe('mapStravaSegment', () => {
  it('[lat,lng] 映射为起终点并携带 stravaId', () => {
    const mapped = mapStravaSegment({
      id: 99,
      name: '外滩冲刺线',
      start_latlng: [31.23, 121.49],
      end_latlng: [31.25, 121.51],
    })
    expect(mapped).toMatchObject({
      name: '外滩冲刺线',
      startLatitude: 31.23,
      startLongitude: 121.49,
      endLatitude: 31.25,
      endLongitude: 121.51,
      sourceActivityId: 'strava',
      stravaId: 99,
    })
  })

  it('缺起终点坐标返回 null（不可匹配）', () => {
    const partial: StravaSegmentSummary = { id: 1, name: '无坐标' }
    expect(mapStravaSegment(partial)).toBeNull()
    expect(
      mapStravaSegment({ id: 2, name: '半截', start_latlng: [31.2, 121.4] }),
    ).toBeNull()
  })
})

describe('filterNewSegments', () => {
  it('按 stravaId 去重，本地手建赛段不参与去重', () => {
    const existing = [
      { name: '已有', stravaId: 10 },
      { name: '手建', stravaId: undefined },
    ]
    const incoming = [
      { name: '重复', stravaId: 10 },
      { name: '新赛段', stravaId: 11 },
      { name: '无 ID' },
    ]
    expect(filterNewSegments(existing, incoming)).toEqual([{ name: '新赛段', stravaId: 11 }])
  })

  it('incoming 内部同 stravaId 也只保留一个', () => {
    const incoming = [
      { name: 'a', stravaId: 1 },
      { name: 'b', stravaId: 1 },
    ]
    expect(filterNewSegments([], incoming)).toHaveLength(1)
  })
})

describe('fetchStarredSegments', () => {
  it('不足整页时停止翻页，返回收藏赛段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: 1, name: '滨江线', start_latlng: [31.2, 121.5], end_latlng: [31.3, 121.6] }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchStarredSegments('token-abc')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
    // 只请求了第 1 页
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/segments/starred?per_page=30&page=1')
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer token-abc' } })
  })

  it('401 时抛错（Token 过期场景）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)))
    await expect(fetchStarredSegments('expired')).rejects.toThrow('401')
  })
})

describe('fetchExploreSegments', () => {
  it('按 bounds 与活动类型构造探索请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        segments: [{ id: 7, name: '绕圈', start_latlng: [31.2, 121.5], end_latlng: [31.2, 121.5] }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchExploreSegments('token-abc', {
      south: 31.0,
      west: 121.3,
      north: 31.4,
      east: 121.7,
    })
    expect(result).toHaveLength(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/segments/explore?')
    expect(url).toContain('bounds=31,121.3,31.4,121.7')
    expect(url).toContain('activity_type=riding')
  })

  it('响应缺 segments 字段时回退空数组', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
    await expect(
      fetchExploreSegments('t', { south: 0, west: 0, north: 1, east: 1 }),
    ).resolves.toEqual([])
  })
})
