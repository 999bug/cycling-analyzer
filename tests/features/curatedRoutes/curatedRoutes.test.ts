/**
 * 精选热门路线数据完整性测试。
 *
 * 精选路线是「事实数据」：里程/爬升必须带权威来源，几何必须存在且与申报量级一致，
 * 防止后续添加路线（二期全国）时混入编造数字或空几何。
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_CURATED_ROUTES,
  CURATED_REGIONS,
  curatedRoutesOf,
} from '@/features/curatedRoutes'
import { BEIJING_TRACKS } from '@/features/curatedRoutes/beijingTracks'
import { sourceGradeLabel } from '@/features/curatedRoutes/types'
import { haversineMeters } from '@/features/routes/routeGrouping'

/** 地球近似：折线长度累加（与路线图页同口径） */
function polylineLengthMeters(track: [number, number][]): number {
  let sum = 0
  for (let i = 1; i < track.length; i += 1) {
    sum += haversineMeters(
      { latitude: track[i - 1]![0], longitude: track[i - 1]![1] },
      { latitude: track[i]![0], longitude: track[i]![1] },
    )
  }
  return sum
}

/** 中国大陆范围的合理坐标界（防坐标错位/写反） */
const CHINA_LAT_RANGE = [18, 54] as const
const CHINA_LNG_RANGE = [73, 135] as const

describe('curatedRoutes 数据完整性', () => {
  it('路线 ID 唯一', () => {
    const ids = ALL_CURATED_ROUTES.map((route) => route.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条路线的必填字段齐全且来源可溯', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(route.name.length).toBeGreaterThan(0)
      expect(route.area.length).toBeGreaterThan(0)
      expect(route.description.length).toBeGreaterThan(0)
      expect(route.tips.length).toBeGreaterThan(0)
      // 权威来源标注是硬要求：没有来源的里程不允许上线
      expect(route.source.length).toBeGreaterThan(0)
      expect(route.distanceMeters).toBeGreaterThan(0)
      expect(route.elevationGainMeters).toBeGreaterThan(0)
      expect(route.difficulty).toBeGreaterThanOrEqual(1)
      expect(route.difficulty).toBeLessThanOrEqual(5)
    }
  })

  it('每条路线的几何存在且坐标在中国范围内', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(route.tracks.length).toBeGreaterThan(0)
      for (const track of route.tracks) {
        expect(track.length).toBeGreaterThanOrEqual(2)
        for (const [lat, lng] of track) {
          expect(lat).toBeGreaterThanOrEqual(CHINA_LAT_RANGE[0])
          expect(lat).toBeLessThanOrEqual(CHINA_LAT_RANGE[1])
          expect(lng).toBeGreaterThanOrEqual(CHINA_LNG_RANGE[0])
          expect(lng).toBeLessThanOrEqual(CHINA_LNG_RANGE[1])
        }
      }
    }
  })

  it('几何折线长度与申报里程同量级（OSM 简化示意允许偏差，但不允许差一个数量级）', () => {
    for (const route of ALL_CURATED_ROUTES) {
      const drawn = route.tracks.reduce((sum, track) => sum + polylineLengthMeters(track), 0)
      if (route.geometryScope === 'core') {
        // core 路线：路径线仅覆盖核心段，与全程申报里程天然不同量级；
        // 只要求是真实几何（≥500m），量级一致性由「core 标注一致性」用例把关
        expect(drawn).toBeGreaterThan(500)
        continue
      }
      // 妙峰山 OSM 路网比官方口径短约 1/3；容差取 [0.5, 1.6]
      expect(drawn).toBeGreaterThanOrEqual(route.distanceMeters * 0.5)
      expect(drawn).toBeLessThanOrEqual(route.distanceMeters * 1.6)
    }
  })

  it('几何起终点与路线地理常识一致（按地区粗界框，防锚点错位类错误）', () => {
    // 每个地区一个粗界框：二期扩全国时在此登记新地区界框
    const REGION_BBOX: Record<string, { lat: [number, number]; lng: [number, number] }> = {
      // 北京全域（房山十渡 → 延庆官厅、昌平 → 门头沟）
      beijing: { lat: [39.5, 40.8], lng: [115.4, 116.8] },
    }
    for (const route of ALL_CURATED_ROUTES) {
      const bbox = REGION_BBOX[route.region]
      expect(bbox).toBeDefined()
      const points = route.tracks.flat()
      for (const [lat, lng] of points) {
        expect(lat).toBeGreaterThan(bbox!.lat[0])
        expect(lat).toBeLessThan(bbox!.lat[1])
        expect(lng).toBeGreaterThan(bbox!.lng[0])
        expect(lng).toBeLessThan(bbox!.lng[1])
      }
    }
  })

  it('注册表与数据文件互相一致', () => {
    expect(CURATED_REGIONS.map((region) => region.id)).toEqual(['beijing'])
    expect(curatedRoutesOf('beijing')).toEqual(ALL_CURATED_ROUTES)
    // 北京路线的 tracks 引用必须指向生成数据里真实存在的 key（bj-<id> → 生成脚本短名）
    expect(Object.keys(BEIJING_TRACKS).sort()).toEqual([
      'bll',
      'cby',
      'cf',
      'dc',
      'dfh',
      'gyk',
      'hcl',
      'hhc',
      'hjl',
      'hsl',
      'hsl2',
      'jietai',
      'jzs',
      'miaofeng',
      'ms',
      'sb',
      'sh',
      'tanwang',
      'yts',
      'yxh',
    ])
    for (const route of curatedRoutesOf('beijing')) {
      expect(route.tracks.length).toBeGreaterThan(0)
    }
  })

  it('每条路线都带来源等级，且等级文案映射正确', () => {
    for (const route of ALL_CURATED_ROUTES) {
      expect(['A', 'B', 'C']).toContain(route.sourceGrade)
    }
    expect(sourceGradeLabel('A')).toBe('官方口径')
    expect(sourceGradeLabel('B')).toBe('权威媒体')
    expect(sourceGradeLabel('C')).toBe('社区码表')
  })

  it('长距离环线/往返路线必须标注 core 几何口径（路径线仅覆盖核心段）', () => {
    for (const route of ALL_CURATED_ROUTES) {
      const drawn = route.tracks.reduce((sum, track) => sum + polylineLengthMeters(track), 0)
      // full 路线的量级下限是 0.5（见上一用例）：低于下限却标 full 即为漏标
      if (drawn < route.distanceMeters * 0.5) {
        expect(route.geometryScope).toBe('core')
      }
    }
  })
})
