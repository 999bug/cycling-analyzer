/**
 * 地图瓦片源与坐标转换测试。
 *
 * - TILE_SOURCES：默认 OSM、降级高德（国内直连可用）；
 * - wgs84ToGcj02：境内点向东北偏移数百米、境外点原样返回、转换确定性。
 */
import { describe, expect, it } from 'vitest'
import { TILE_SOURCES, wgs84ToGcj02 } from '@/map/tileSources'

describe('瓦片源定义', () => {
  it('默认源为 OSM，降级源为高德', () => {
    expect(TILE_SOURCES).toHaveLength(2)
    expect(TILE_SOURCES[0].url).toContain('tile.openstreetmap.org')
    expect(TILE_SOURCES[1].url).toContain('is.autonavi.com')
  })

  it('高德源带子域占位与版权署名', () => {
    const amap = TILE_SOURCES[1]
    expect(amap.url).toContain('{s}')
    expect(amap.url).toContain('{x}')
    expect(amap.url).toContain('{y}')
    expect(amap.url).toContain('{z}')
    expect(amap.subdomains).toHaveLength(4)
    expect(amap.attribution).toContain('高德')
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
