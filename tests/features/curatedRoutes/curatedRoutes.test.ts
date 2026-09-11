/**
 * 精选热门路线数据完整性测试。
 *
 * 精选路线是「事实数据」：里程/爬升必须带权威来源，几何必须存在且与申报量级一致，
 * 防止后续添加路线（二期全国）时混入编造数字或空几何。
 */
import { describe, expect, it } from 'vitest'
import { ALL_CURATED_ROUTES, CURATED_REGIONS, curatedRoutesOf } from '@/features/curatedRoutes'
import { BEIJING_TRACKS } from '@/features/curatedRoutes/beijingTracks'
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
      // 妙峰山 OSM 路网比官方口径短约 1/3；容差取 [0.5, 1.6]
      expect(drawn).toBeGreaterThanOrEqual(route.distanceMeters * 0.5)
      expect(drawn).toBeLessThanOrEqual(route.distanceMeters * 1.6)
    }
  })

  it('几何起终点与路线地理常识一致（京西门头沟一带）', () => {
    // 一期全部为北京门头沟路线：粗界框防锚点错位类错误
    for (const route of ALL_CURATED_ROUTES) {
      const points = route.tracks.flat()
      for (const [lat, lng] of points) {
        expect(lat).toBeGreaterThan(39.7)
        expect(lat).toBeLessThan(40.2)
        expect(lng).toBeGreaterThan(115.8)
        expect(lng).toBeLessThan(116.3)
      }
    }
  })

  it('注册表与数据文件互相一致', () => {
    expect(CURATED_REGIONS.map((region) => region.id)).toEqual(['beijing'])
    expect(curatedRoutesOf('beijing')).toEqual(ALL_CURATED_ROUTES)
    // 北京路线的 tracks 引用必须指向生成数据里真实存在的 key（bj-miaofengshan → miaofeng）
    expect(Object.keys(BEIJING_TRACKS).sort()).toEqual(['jietai', 'miaofeng', 'tanwang'])
    for (const route of curatedRoutesOf('beijing')) {
      expect(route.tracks.length).toBeGreaterThan(0)
    }
  })
})
