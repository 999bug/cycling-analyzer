/**
 * 回放视频导出纯计算测试：Web Mercator 投影、拟合缩放、瓦片范围。
 * 画布/MediaRecorder 相关路径依赖真实浏览器环境，不在 jsdom 覆盖范围。
 */
import { describe, expect, it } from 'vitest'
import {
  computeFittedZoom,
  computeTileRange,
  latToWorldPx,
  lngToWorldPx,
} from '@/features/activity/trackVideoExport'

describe('Web Mercator 投影', () => {
  it('lngToWorldPx：经度 0 在世界中心，每升一级缩放坐标翻倍', () => {
    expect(lngToWorldPx(0, 0)).toBe(128)
    expect(lngToWorldPx(0, 3)).toBe(128 * 8)
    // 经度 -180 / 180 落在金字塔两端
    expect(lngToWorldPx(-180, 2)).toBe(0)
    expect(lngToWorldPx(180, 2)).toBe(256 * 4)
  })

  it('latToWorldPx：纬度 0 在世界中心，极端纬度钳制在墨卡托有效域', () => {
    expect(latToWorldPx(0, 0)).toBe(128)
    // ±85.0511° 对应金字塔上下边缘（约 0 / 256），超出值被钳制
    expect(latToWorldPx(85.05112878, 0)).toBeCloseTo(0, 5)
    expect(latToWorldPx(-85.05112878, 0)).toBeCloseTo(256, 5)
    expect(latToWorldPx(89, 0)).toBeCloseTo(0, 5)
  })
})

describe('computeFittedZoom 拟合缩放', () => {
  const CANVAS_W = 1280
  const CANVAS_H = 720
  const PADDING = 80

  it('极小包围盒返回上限 17（街道级细节）', () => {
    const zoom = computeFittedZoom(
      { minLat: 31.2, maxLat: 31.2001, minLng: 121.4, maxLng: 121.4001 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBe(17)
  })

  it('超大包围盒（跨国骑行）返回下限 2，不越界', () => {
    const zoom = computeFittedZoom(
      { minLat: -40, maxLat: 50, minLng: -10, maxLng: 120 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBe(2)
  })

  it('中等包围盒返回单调合理的中间级别（城区一日骑行）', () => {
    const zoom = computeFittedZoom(
      { minLat: 31.15, maxLat: 31.35, minLng: 121.3, maxLng: 121.6 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBeGreaterThan(2)
    expect(zoom).toBeLessThan(17)
  })

  it('缩放级别随包围盒增大单调不增', () => {
    const small = computeFittedZoom(
      { minLat: 31.2, maxLat: 31.25, minLng: 121.4, maxLng: 121.45 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    const large = computeFittedZoom(
      { minLat: 31.0, maxLat: 31.45, minLng: 121.1, maxLng: 121.75 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(large).toBeLessThanOrEqual(small)
  })
})

describe('computeTileRange 瓦片范围', () => {
  it('常规视口返回连续的小范围（约 6×4 张）', () => {
    const range = computeTileRange(14, 3_000_000, 1_600_000, 1280, 720)
    expect(range.xEnd - range.xStart).toBeLessThanOrEqual(6)
    expect(range.yEnd - range.yStart).toBeLessThanOrEqual(4)
    expect(range.xEnd).toBeGreaterThanOrEqual(range.xStart)
    expect(range.yEnd).toBeGreaterThanOrEqual(range.yStart)
  })

  it('视口越出金字塔边界时钳制到 [0, 2^z - 1]', () => {
    const range = computeTileRange(2, 0, 0, 1280, 720)
    expect(range.xStart).toBe(0)
    expect(range.yStart).toBe(0)
    expect(range.xEnd).toBeLessThanOrEqual(3)
    expect(range.yEnd).toBeLessThanOrEqual(3)
  })
})
