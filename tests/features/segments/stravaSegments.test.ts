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
  filterNewGpxSegments,
  parseSegmentGpx,
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

// ---------------------------------------------------------------------------
// parseSegmentGpx / filterNewGpxSegments
// ---------------------------------------------------------------------------

/** 构造最小 GPX 文本（Strava 导出格式子集） */
function gpxXml(opts: { name?: string; metadataName?: string; points: [number, number][] }): string {
  const pts = opts.points.map(([lat, lng]) => `<trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('')
  const trkName = opts.name !== undefined ? `<name>${opts.name}</name>` : ''
  const metaName = opts.metadataName !== undefined ? `<metadata><name>${opts.metadataName}</name></metadata>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><gpx>${metaName}<trk>${trkName}<trkseg>${pts}</trkseg></trk></gpx>`
}

describe('parseSegmentGpx', () => {
  it('解析首末点为起终点，名称取 track 名', () => {
    const segment = parseSegmentGpx(
      gpxXml({ name: '滨江冲刺线', points: [[31.21, 121.49], [31.22, 121.5], [31.23, 121.51]] }),
      'whatever.gpx',
    )
    expect(segment).toMatchObject({
      name: '滨江冲刺线',
      startLatitude: 31.21,
      startLongitude: 121.49,
      endLatitude: 31.23,
      endLongitude: 121.51,
      sourceActivityId: 'strava',
    })
    expect(segment?.stravaId).toBeUndefined()
  })

  it('无 track 名时回退 metadata 名，再回退文件名去 .gpx 后缀', () => {
    const meta = parseSegmentGpx(gpxXml({ metadataName: '元数据名', points: [[1, 2], [3, 4]] }), 'fallback.gpx')
    expect(meta?.name).toBe('元数据名')
    const fallback = parseSegmentGpx(gpxXml({ points: [[1, 2], [3, 4]] }), '西山爬坡.gpx')
    expect(fallback?.name).toBe('西山爬坡')
  })

  it('过滤无效坐标点；全部无效返回 null', () => {
    const xml =
      '<?xml version="1.0"?><gpx><trk><trkseg>' +
      '<trkpt lat="abc" lon="0"></trkpt><trkpt lat="1" lon="NaN"></trkpt><trkpt lat="31.2" lon="121.4"></trkpt>' +
      '</trkseg></trk></gpx>'
    const one = parseSegmentGpx(xml, 'a.gpx')
    expect(one).toMatchObject({ startLatitude: 31.2, startLongitude: 121.4, endLatitude: 31.2, endLongitude: 121.4 })
    expect(parseSegmentGpx('<gpx><trk><trkseg></trkseg></trk></gpx>', 'empty.gpx')).toBeNull()
  })

  it('XML 解析失败抛错', () => {
    expect(() => parseSegmentGpx('<gpx><未闭合>', 'bad.gpx')).toThrow('Invalid GPX file')
  })
})

describe('filterNewGpxSegments', () => {
  it('按名称+起终点坐标去重，不同坐标同名保留', () => {
    const existing = [
      { name: 'A 段', startLatitude: 31.2, startLongitude: 121.4, endLatitude: 31.3, endLongitude: 121.5 },
    ]
    const incoming = [
      { name: 'A 段', startLatitude: 31.200001, startLongitude: 121.400001, endLatitude: 31.3, endLongitude: 121.5 },
      { name: 'B 段', startLatitude: 30.0, startLongitude: 120.0, endLatitude: 30.1, endLongitude: 120.1 },
    ]
    const fresh = filterNewGpxSegments(existing, incoming)
    // A 段坐标 5 位小数一致 → 去重；B 段新 → 保留
    expect(fresh).toHaveLength(1)
    expect(fresh[0].name).toBe('B 段')
  })

  it('incoming 内部同 key 只保留一个', () => {
    const incoming = [
      { name: 'X', startLatitude: 1, startLongitude: 2, endLatitude: 3, endLongitude: 4 },
      { name: 'X', startLatitude: 1.000001, startLongitude: 2, endLatitude: 3, endLongitude: 4 },
    ]
    expect(filterNewGpxSegments([], incoming)).toHaveLength(1)
  })
})
