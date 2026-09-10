/**
 * 运动类型归一化测试：9 个支持平台的实际取值 + 未知写法兜底。
 */
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_OPTIONS,
  activityTypeLabel,
  isCyclingType,
  normalizeActivityType,
} from '@/types/activityType'

describe('normalizeActivityType 各平台真实取值', () => {
  it('FIT session.sport（SDK 解码后的枚举名）', () => {
    expect(normalizeActivityType('cycling')).toBe('cycling')
    expect(normalizeActivityType('running')).toBe('running')
    expect(normalizeActivityType('walking')).toBe('walking')
    expect(normalizeActivityType('hiking')).toBe('hiking')
    expect(normalizeActivityType('swimming')).toBe('swimming')
  })

  it('佳明 GDPR 摘要 JSON 的细分骑行类型（不能只认 cycling 字面量）', () => {
    expect(normalizeActivityType('road_biking')).toBe('cycling')
    expect(normalizeActivityType('mountain_biking')).toBe('cycling')
    expect(normalizeActivityType('gravel_cycling')).toBe('cycling')
    expect(normalizeActivityType('virtual_ride')).toBe('cycling')
    expect(normalizeActivityType('indoor_cycling')).toBe('cycling')
    expect(normalizeActivityType('downhill_biking')).toBe('cycling')
    expect(normalizeActivityType('e_bike_ride')).toBe('cycling')
  })

  it('Strava activities.csv 的中文活动类型', () => {
    expect(normalizeActivityType('骑行')).toBe('cycling')
    expect(normalizeActivityType('跑步')).toBe('running')
    expect(normalizeActivityType('步行')).toBe('walking')
    expect(normalizeActivityType('徒步')).toBe('hiking')
    expect(normalizeActivityType('游泳')).toBe('swimming')
  })

  it('Strava 英文驼峰类型（GPX 导出/网页端写法）', () => {
    expect(normalizeActivityType('Ride')).toBe('cycling')
    expect(normalizeActivityType('VirtualRide')).toBe('cycling')
    expect(normalizeActivityType('EBikeRide')).toBe('cycling')
    expect(normalizeActivityType('Run')).toBe('running')
    expect(normalizeActivityType('TrailRun')).toBe('running')
    expect(normalizeActivityType('Walk')).toBe('walking')
    expect(normalizeActivityType('Hike')).toBe('hiking')
  })

  it('大小写、首尾空白、空格与短横线写法', () => {
    expect(normalizeActivityType('  CYCLING  ')).toBe('cycling')
    expect(normalizeActivityType('Road Biking')).toBe('cycling')
    expect(normalizeActivityType('road-biking')).toBe('cycling')
    expect(normalizeActivityType('Treadmill Running')).toBe('running')
  })

  it('未知与缺失一律归 other，不猜测为骑行', () => {
    expect(normalizeActivityType(undefined)).toBe('other')
    expect(normalizeActivityType('')).toBe('other')
    expect(normalizeActivityType('   ')).toBe('other')
    expect(normalizeActivityType('generic')).toBe('other')
    expect(normalizeActivityType('rowing')).toBe('other')
    expect(normalizeActivityType('zzz-unknown-sport')).toBe('other')
  })
})

describe('normalizeActivityType 关键词兜底', () => {
  it('别名表未收录但含明确关键词时按子串归类', () => {
    expect(normalizeActivityType('morning cycling session')).toBe('cycling')
    expect(normalizeActivityType('城市骑行')).toBe('cycling')
    expect(normalizeActivityType('晨跑')).toBe('running')
    expect(normalizeActivityType('越野跑')).toBe('running')
    expect(normalizeActivityType('晚间散步')).toBe('walking')
    expect(normalizeActivityType('竞走')).toBe('walking')
    expect(normalizeActivityType('爬山')).toBe('hiking')
  })

  it('关键词顺序：「徒步」不得被步行规则抢先命中「步」字', () => {
    expect(normalizeActivityType('徒步')).toBe('hiking')
    expect(normalizeActivityType('轻装徒步')).toBe('hiking')
    expect(normalizeActivityType('散步')).toBe('walking')
  })

  it('关键词顺序：骑行规则优先于徒步，mountain biking 不被 mount 抢走', () => {
    expect(normalizeActivityType('mountain biking')).toBe('cycling')
    expect(normalizeActivityType('mountain-bike-ride')).toBe('cycling')
  })
})

describe('isCyclingType', () => {
  it('对库中历史遗留写法同样可靠', () => {
    expect(isCyclingType('cycling')).toBe(true)
    expect(isCyclingType('road_biking')).toBe(true)
    expect(isCyclingType('骑行')).toBe(true)
    expect(isCyclingType('Ride')).toBe(true)
  })

  it('非骑行与缺失返回 false', () => {
    expect(isCyclingType('running')).toBe(false)
    expect(isCyclingType('walking')).toBe(false)
    expect(isCyclingType('other')).toBe(false)
    expect(isCyclingType(undefined)).toBe(false)
    expect(isCyclingType('')).toBe(false)
  })
})

describe('activityTypeLabel', () => {
  it('已知类型返回中文标签', () => {
    expect(activityTypeLabel('cycling')).toBe('骑行')
    expect(activityTypeLabel('road_biking')).toBe('骑行')
    expect(activityTypeLabel('跑步')).toBe('跑步')
  })

  it('未知类型回退「其他」而非显示原始英文值', () => {
    expect(activityTypeLabel('rowing')).toBe('其他')
    expect(activityTypeLabel(undefined)).toBe('其他')
  })
})

describe('ACTIVITY_TYPE_OPTIONS', () => {
  it('覆盖全部规范类型且标签与映射表一致', () => {
    expect(ACTIVITY_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'cycling',
      'running',
      'walking',
      'hiking',
      'swimming',
      'other',
    ])
    for (const option of ACTIVITY_TYPE_OPTIONS) {
      expect(option.label).toBe(ACTIVITY_TYPE_LABELS[option.value])
    }
  })
})
