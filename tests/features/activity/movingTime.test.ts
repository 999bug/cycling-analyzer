/**
 * 「运动中」判定测试（活动计时时长与回放时间轴的共同口径）。
 *
 * 覆盖三档判定：正常间隔按位移速度、短缺口按两段位移、长缺口整段剔除。
 */
import { describe, expect, it } from 'vitest'
import {
  isMovingSegment,
  movingDurationOf,
  MOVING_SPEED_THRESHOLD_MPS,
} from '@/features/activity/movingTime'

describe('isMovingSegment（相邻点运动判定）', () => {
  it('正常间隔：位移速度高于阈值计入，低于阈值（含完全静止）不计入', () => {
    expect(MOVING_SPEED_THRESHOLD_MPS).toBe(0.5)
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 1, distance: 10 })).toBe(true)
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 1, distance: 0 })).toBe(false)
    // 0.2 m/s < 0.5：静止时的 GPS 漂移不计入
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 1, distance: 0.2 })).toBe(false)
  })

  it('短缺口（30~60s）：按两端位移区分挪动与完全停止', () => {
    // 40s 挪动 10m（0.25 m/s，速度口径会误判为静止）→ 计时未停，计入
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 40, distance: 10 })).toBe(true)
    // 40s 仅漂移 2m → 已暂停，不计入
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 40, distance: 2 })).toBe(false)
    // 边界 60s 仍走短缺口分支
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 60, distance: 10 })).toBe(true)
  })

  it('长缺口（>60s）与时间倒流/重复一律视为暂停', () => {
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 61, distance: 500 })).toBe(false)
    expect(isMovingSegment({ timestamp: 0, distance: 0 }, { timestamp: 0, distance: 500 })).toBe(false)
    expect(isMovingSegment({ timestamp: 10, distance: 0 }, { timestamp: 5, distance: 500 })).toBe(false)
  })

  it('缺失累计距离按位移 0 处理（沿用活动汇总原口径，缺失即视为无位移）', () => {
    expect(isMovingSegment({ timestamp: 0 }, { timestamp: 1 })).toBe(false)
    expect(isMovingSegment({ timestamp: 1, distance: 10 }, { timestamp: 2 })).toBe(false)
    expect(isMovingSegment({ timestamp: 1 }, { timestamp: 2, distance: 10 })).toBe(true)
  })
})

describe('movingDurationOf（运动时长累计）', () => {
  it('只累计运动段：10s 骑行 + 60s 红灯 + 10s 骑行 → 20s', () => {
    const points = [
      { timestamp: 0, distance: 0 },
      { timestamp: 10, distance: 100 },
      { timestamp: 30, distance: 100 },
      { timestamp: 50, distance: 100 },
      { timestamp: 70, distance: 100 },
      { timestamp: 80, distance: 200 },
    ]
    expect(movingDurationOf(points)).toBe(20)
  })

  it('空集与单点返回 0', () => {
    expect(movingDurationOf([])).toBe(0)
    expect(movingDurationOf([{ timestamp: 0, distance: 0 }])).toBe(0)
  })
})
