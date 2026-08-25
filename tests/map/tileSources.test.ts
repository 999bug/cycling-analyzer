/**
 * 地图瓦片源与坐标转换测试。
 *
 * - TILE_SOURCES：默认高德、降级 OSM（境内访问稳定快速）；
 * - 语义化辅助函数：isGcjSource 纠偏判定 / loadStoredSourceIndex 与
 *   storeSourceIndex 会话记忆（语义字符串存储，调换顺序互不干扰）；
 * - wgs84ToGcj02：境内点向东北偏移数百米、境外点原样返回、转换确定性。
 */
import { describe, expect, it } from 'vitest'
import {
  isGcjSource,
  loadStoredSourceIndex,
  storeSourceIndex,
  TILE_SOURCES,
  wgs84ToGcj02,
} from '@/map/tileSources'

describe('瓦片源定义', () => {
  it('默认源为高德，降级源为 OSM', () => {
    expect(TILE_SOURCES).toHaveLength(2)
    expect(TILE_SOURCES[0].url).toContain('is.autonavi.com')
    expect(TILE_SOURCES[1].url).toContain('tile.openstreetmap.org')
  })

  it('高德源（默认）带子域占位与版权署名', () => {
    const amap = TILE_SOURCES[0]
    expect(amap.url).toContain('{s}')
    expect(amap.url).toContain('{x}')
    expect(amap.url).toContain('{y}')
    expect(amap.url).toContain('{z}')
    expect(amap.subdomains).toHaveLength(4)
    expect(amap.attribution).toContain('高德')
  })

  it('isGcjSource：索引 0 为高德（需纠偏），索引 1 为 OSM', () => {
    expect(isGcjSource(0)).toBe(true)
    expect(isGcjSource(1)).toBe(false)
    expect(isGcjSource(99)).toBe(true) // 未知索引回退默认源
  })

  it('会话记忆：无记忆返回默认源，按语义标识存取（顺序无关）', () => {
    sessionStorage.removeItem('cycling-map-tile-fallback')
    expect(loadStoredSourceIndex()).toBe(0)

    storeSourceIndex(1)
    expect(sessionStorage.getItem('cycling-map-tile-fallback')).toBe('osm')
    expect(loadStoredSourceIndex()).toBe(1)

    storeSourceIndex(0)
    expect(sessionStorage.getItem('cycling-map-tile-fallback')).toBe('amap')
    expect(loadStoredSourceIndex()).toBe(0)
  })
})

describe('wgs84ToGcj02 坐标转换', () => {
  it('境内点向东北偏移数百米（天安门附近，在线工具成对参考值）', () => {
    // 成对参考值来自在线坐标转换工具（lddgo.net 示例），输入输出同源避免版本混搭
    const result = wgs84ToGcj02({ longitude: 116.391349, latitude: 39.907375 })

    // GCJ-02 相对 WGS-84 向东北偏移：经度约 +0.0062 度（≈580 米），纬度约 +0.0014 度（≈155 米）
    expect(result.longitude).toBeGreaterThan(116.391349)
    expect(result.latitude).toBeGreaterThan(39.907375)
    expect(result.longitude).toBeCloseTo(116.39759, 3)
    expect(result.latitude).toBeCloseTo(39.908776, 3)
  })

  it('境外点原样返回（旧金山）', () => {
    expect(wgs84ToGcj02({ longitude: -122.4194, latitude: 37.7749 })).toEqual({
      longitude: -122.4194,
      latitude: 37.7749,
    })
  })

  it('境内判定边界外点原样返回', () => {
    expect(wgs84ToGcj02({ longitude: 72.0, latitude: 0.8 })).toEqual({
      longitude: 72.0,
      latitude: 0.8,
    })
  })

  it('同输入转换结果确定', () => {
    const point = { longitude: 116.391275, latitude: 39.906217 }
    expect(wgs84ToGcj02(point)).toEqual(wgs84ToGcj02(point))
  })
})
