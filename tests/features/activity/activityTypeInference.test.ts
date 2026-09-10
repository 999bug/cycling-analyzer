/**
 * 运动类型速度特征推断测试。
 *
 * 阈值来源见模块注释：跑步速度有硬上界（马拉松世界纪录约 21.0 km/h），
 * 而骑行可以很慢（共享单车/带娃/爬坡），故速度只能单向使用。
 */
import { describe, expect, it } from 'vitest'
import {
  CYCLING_MIN_DISTANCE_KM,
  CYCLING_MIN_SPEED_KMH,
  RUNNING_MAX_DISTANCE_KM,
  RUNNING_MAX_SPEED_KMH,
  WALKING_MAX_SPEED_KMH,
  describeTypeInference,
  inferActivityType,
  isTypeSuspect,
} from '@/features/activity/activityTypeInference'

/** 由距离（km）与均速（km/h）构造推断输入（avgSpeed 单位 m/s） */
function input(distanceKm: number, avgSpeedKmh: number) {
  const distance = distanceKm * 1000
  const avgSpeed = avgSpeedKmh / 3.6
  const duration = distance / avgSpeed
  return { distance, duration, avgSpeed }
}

describe('inferActivityType 步行', () => {
  it('均速不超过步行上界判步行（散步/快走）', () => {
    expect(inferActivityType(input(3, 4.5)).type).toBe('walking')
    expect(inferActivityType(input(8, 6.5)).type).toBe('walking')
    expect(inferActivityType(input(12, WALKING_MAX_SPEED_KMH)).type).toBe('walking')
  })

  it('步行判据置信度为 high', () => {
    expect(inferActivityType(input(3, 4.5)).confidence).toBe('high')
  })
})

describe('inferActivityType 跑步', () => {
  it('超过步行上界、不足骑行下界且距离不长时判跑步', () => {
    expect(inferActivityType(input(5, 9.8)).type).toBe('running')
    expect(inferActivityType(input(10, 12)).type).toBe('running')
    expect(inferActivityType(input(15, 16)).type).toBe('running')
  })

  it('跑步判据置信度为 medium（导入可采纳，但会告知用户）', () => {
    expect(inferActivityType(input(5, 9.8)).confidence).toBe('medium')
  })

  it('距离超过跑步上界时降级为灰区（马拉松交用户确认，不自动判跑步）', () => {
    const marathon = inferActivityType(input(42.2, 9))
    // 仍作为「疑似非骑行」列出（供用户确认），但置信度降级为 grey
    expect(marathon.confidence).toBe('grey')
    expect(isTypeSuspect(marathon)).toBe(true)
  })
})

describe('inferActivityType 骑行', () => {
  it('均速达到骑行下界即判骑行（超过人类跑步速度上界）', () => {
    expect(inferActivityType(input(40, 24.7)).type).toBe('cycling')
    expect(inferActivityType(input(100, CYCLING_MIN_SPEED_KMH)).type).toBe('cycling')
    // 实测样本：作者 80 条真实骑行的最低一条 18.94 km/h / 5.1km —— 落在灰区，不误判
    expect(inferActivityType(input(5.1, 18.94)).confidence).toBe('grey')
  })

  it('距离门限兜住长途慢骑：100km / 9km/h 的负重骑仍判骑行', () => {
    const loaded = inferActivityType(input(100, 9))
    expect(loaded.type).toBe('cycling')
    expect(loaded.confidence).toBe('high')
  })

  it('长距离（≥50km）即使速度低也判骑行', () => {
    expect(inferActivityType(input(CYCLING_MIN_DISTANCE_KM, 11)).type).toBe('cycling')
  })
})

describe('inferActivityType 灰区（骑行与跑步重叠）', () => {
  it('10~20 km/h 且不足 50km 判灰区，建议跑步但不得自动写入', () => {
    const cityCommute = inferActivityType(input(12.4, 13.2))
    expect(cityCommute.type).toBe('running')
    expect(cityCommute.confidence).toBe('grey')
  })

  it('灰区依据文案标注重叠区', () => {
    expect(describeTypeInference(inferActivityType(input(12.4, 13.2)))).toContain('重叠区')
  })
})

describe('inferActivityType 缺失容错', () => {
  it('缺距离或时长不判非骑行，保守保留骑行', () => {
    const noDuration = inferActivityType({ distance: 5000, duration: 0 })
    expect(noDuration.type).toBe('cycling')
    expect(noDuration.evidence.insufficient).toBe(true)
    expect(noDuration.type).not.toBe('running')

    const noDistance = inferActivityType({ distance: 0, duration: 1800 })
    expect(noDistance.type).toBe('cycling')
    expect(noDistance.evidence.insufficient).toBe(true)
  })

  it('avgSpeed 缺失时回退为 距离 ÷ 计时时长', () => {
    const result = inferActivityType({ distance: 3000, duration: 2400 })
    expect(result.type).toBe('walking')
    expect(result.evidence.avgSpeedKmh).toBeCloseTo(4.5, 1)
  })

  it('优先使用入库的 avgSpeed（与页面显示口径一致）', () => {
    // 距离/时长会算出 10 km/h，但入库均速为 24 km/h：应以入库值为准判骑行
    const result = inferActivityType({ distance: 10000, duration: 3600, avgSpeed: 24 / 3.6 })
    expect(result.type).toBe('cycling')
  })
})

describe('isTypeSuspect', () => {
  it('只有推断为非骑行的才列为待复核候选', () => {
    expect(isTypeSuspect(inferActivityType(input(5, 9.8)))).toBe(true)
    expect(isTypeSuspect(inferActivityType(input(3, 4.5)))).toBe(true)
    expect(isTypeSuspect(inferActivityType(input(12.4, 13.2)))).toBe(true)
  })

  it('骑行与数据不足都不提示（避免清单被误报淹没）', () => {
    expect(isTypeSuspect(inferActivityType(input(40, 24.7)))).toBe(false)
    expect(isTypeSuspect(inferActivityType({ distance: 0, duration: 0 }))).toBe(false)
  })
})

describe('describeTypeInference', () => {
  it('含均速与距离，均保留一位小数', () => {
    const text = describeTypeInference(inferActivityType(input(5.2, 9.83)))
    expect(text).toContain('均速 9.8 km/h')
    expect(text).toContain('距离 5.2 km')
  })

  it('数据不足时给出明确说明', () => {
    expect(describeTypeInference(inferActivityType({ distance: 0, duration: 0 }))).toBe(
      '缺少距离或时长，无法判定',
    )
  })
})

describe('阈值常量关系（防止改错方向）', () => {
  it('步行上界 < 跑步上界 < 骑行下界', () => {
    expect(WALKING_MAX_SPEED_KMH).toBeLessThan(RUNNING_MAX_SPEED_KMH)
    expect(RUNNING_MAX_SPEED_KMH).toBeLessThan(CYCLING_MIN_SPEED_KMH)
  })

  it('跑步距离上界远小于骑行距离下界', () => {
    expect(RUNNING_MAX_DISTANCE_KM).toBeLessThan(CYCLING_MIN_DISTANCE_KM)
  })
})
