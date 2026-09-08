/**
 * 来源识别测试：creator 优先、文件名兜底、未知来源默认值与分组。
 */
import { describe, expect, it } from 'vitest'
import {
  SOURCE_PROFILES,
  UNKNOWN_SOURCE,
  detectSource,
  groupSourcesBySystem,
  sourceProfileById,
} from '@/geo/sourceProfiles'

describe('detectSource', () => {
  it('识别 WGS-84 系来源：Strava / Garmin / Wahoo / 本站', () => {
    expect(detectSource('StravaGPX').profile.id).toBe('strava')
    expect(detectSource('Garmin Connect').profile.id).toBe('garmin')
    expect(detectSource('Wahoo ELEMNT').profile.id).toBe('wahoo')
    expect(detectSource('cycling-analyzer').profile.id).toBe('cyclingAnalyzer')
    expect(detectSource('StravaGPX').profile.coordinateSystem).toBe('wgs84')
  })

  it('识别 GCJ-02 系来源：行者 / Keep / 咕咚 / 高德 / 华为', () => {
    expect(detectSource('行者').profile.id).toBe('xingzhe')
    expect(detectSource('Xingzhe Cycling').profile.id).toBe('xingzhe')
    expect(detectSource('Keep').profile.id).toBe('keep')
    expect(detectSource('Codoon').profile.id).toBe('gudong')
    expect(detectSource('Amap').profile.id).toBe('amap')
    expect(detectSource('Huawei Health').profile.id).toBe('huawei')
    expect(detectSource('行者').profile.coordinateSystem).toBe('gcj02')
  })

  it('识别 BD-09 系来源：百度', () => {
    expect(detectSource('Baidu Map').profile.id).toBe('baidu')
    expect(detectSource('百度地图').profile.coordinateSystem).toBe('bd09')
  })

  it('creator 缺失时按文件名兜底', () => {
    const match = detectSource(undefined, '行者_2026-09-08_晨骑.gpx')
    expect(match.profile.id).toBe('xingzhe')
    expect(match.matchedBy).toBe('fileName')
  })

  it('creator 命中时优先于文件名', () => {
    const match = detectSource('StravaGPX', '行者_2026-09-08.gpx')
    expect(match.profile.id).toBe('strava')
    expect(match.matchedBy).toBe('creator')
  })

  it('全部线索缺失时回退未知来源（按 WGS-84 处理）', () => {
    const match = detectSource(undefined, undefined)
    expect(match.profile.id).toBe('unknown')
    expect(match.matchedBy).toBe('default')
    expect(match.profile.coordinateSystem).toBe('wgs84')
  })

  it('大小写不敏感', () => {
    expect(detectSource('STRAVAGPX').profile.id).toBe('strava')
  })
})

describe('sourceProfileById', () => {
  it('按落库标识回显画像', () => {
    expect(sourceProfileById('xingzhe').label).toBe('行者')
    expect(sourceProfileById('baidu').coordinateSystem).toBe('bd09')
  })

  it('未知或缺失标识回退兜底画像', () => {
    expect(sourceProfileById('not-a-source')).toEqual(UNKNOWN_SOURCE)
    expect(sourceProfileById(undefined)).toEqual(UNKNOWN_SOURCE)
  })
})

describe('来源表完整性', () => {
  it('标识唯一', () => {
    const ids = SOURCE_PROFILES.map((profile) => profile.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个来源至少有一个匹配关键词', () => {
    for (const profile of SOURCE_PROFILES) {
      expect(profile.keywords.length).toBeGreaterThan(0)
    }
  })
})

describe('groupSourcesBySystem', () => {
  it('按 wgs84 / gcj02 / bd09 顺序分组且无遗漏', () => {
    const groups = groupSourcesBySystem()
    expect(groups.map((group) => group.system)).toEqual(['wgs84', 'gcj02', 'bd09'])
    const total = groups.reduce((sum, group) => sum + group.profiles.length, 0)
    expect(total).toBe(SOURCE_PROFILES.length)
  })

  it('行者归入 GCJ-02 组', () => {
    const gcjGroup = groupSourcesBySystem().find((group) => group.system === 'gcj02')
    expect(gcjGroup?.profiles.map((profile) => profile.id)).toContain('xingzhe')
  })
})
