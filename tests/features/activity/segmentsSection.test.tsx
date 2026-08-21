/**
 * 合并版「爬坡与分段分析」区块测试（爬坡分析 + 分段分析合并）。
 *
 * 覆盖：剖面数据纯函数（抽稀/坡度平滑分档/分段下标/UCI 徽章锚点）、
 * Recharts 剖面图（坡度着色折线 + 分段色带 + UCI 徽章 + 坐标轴 + 图例）、
 * 悬停 Tooltip 分段详情卡、共享时间轴（悬停上报时间戳 / 外部参考线）、
 * 无爬坡不渲染。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SegmentsSection from '@/features/activity/SegmentsSection'
import {
  buildSegmentProfile,
  gradeBandIndex,
  MAX_PROFILE_POINTS,
  segmentIndexAtDistance,
} from '@/features/activity/segmentsProfile'
import { buildClimbs } from '@/features/activity/climbs'
import { buildSegments } from '@/features/activity/segments'
import type { ActivityRecord } from '@/types/activity'

/** 构造逐点记录：平路 → 爬坡 → 下坡断开 → 第二段爬坡（两段爬坡功率/速度不同）。
 *  纬度加 ±0.0005 交替抖动，防止 Douglas-Peucker 按坐标共线把中间点全部抽稀。 */
function makeTwoClimbRecords(): ActivityRecord[] {
  return [
    [0, 100, 8, 150, 120],
    [250, 100, 8, 150, 120],
    [500, 100, 8, 150, 120],
    [750, 100, 8, 150, 120],
    [1000, 100, 4, 200, 150],
    [1250, 125, 4, 200, 150],
    [1500, 150, 4, 200, 150],
    [1750, 175, 4, 200, 150],
    [2000, 200, 4, 200, 150],
    [2500, 175, 6, 150, 130],
    [3000, 150, 3, 240, 160],
    [3250, 175, 3, 240, 160],
    [3500, 200, 3, 240, 160],
    [3750, 225, 3, 240, 160],
    [4000, 250, 3, 240, 160],
    [4500, 250, 8, 150, 120],
    [5000, 250, 8, 150, 120],
  ].map(([distance, altitude, speed, power, heartRate], index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001 + (index % 2) * 0.0005,
    longitude: 121.5 + index * 0.001,
    distance,
    altitude,
    speed,
    power,
    heartRate,
  }))
}

/** 构造平路记录（无爬坡） */
function makeFlatRecords(): ActivityRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001,
    longitude: 121.5,
    altitude: 100,
    distance: index * 100,
  }))
}

/** 单爬坡记录（海拔持续爬升 4.5%：2km 爬 90m） */
function makeSingleClimbRecords(): ActivityRecord[] {
  return Array.from({ length: 21 }, (_, index) => ({
    timestamp: index * 10,
    latitude: 31.2 + index * 0.001 + (index % 2) * 0.0005,
    longitude: 121.5 + index * 0.001,
    altitude: 100 + index * 4.5,
    distance: index * 100,
  }))
}

/** 无坐标记录（无法构建剖面） */
function makeNoCoordRecords(): ActivityRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    timestamp: index * 10,
    altitude: 100 + index * 50,
    distance: index * 100,
  }))
}

/** 由逐点记录构建分段（纯函数测试通用步骤） */
function buildSegmentsFrom(records: ActivityRecord[]) {
  return buildSegments(records, buildClimbs(records))
}

// jsdom 无真实布局：mock 容器尺寸让 Recharts 正常渲染
afterEach(() => {
  vi.restoreAllMocks()
})

function mockChartLayout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 220,
  } as DOMRect)
}

describe('gradeBandIndex（坡度分档）', () => {
  it('按阈值边界分档：下坡 0 / 平路 1 / 缓坡 2 / 中坡 3 / 陡坡 4', () => {
    expect(gradeBandIndex(-5)).toBe(0)
    expect(gradeBandIndex(-2)).toBe(0)
    expect(gradeBandIndex(0)).toBe(1)
    expect(gradeBandIndex(1)).toBe(1)
    expect(gradeBandIndex(2)).toBe(2)
    expect(gradeBandIndex(3)).toBe(2)
    expect(gradeBandIndex(4)).toBe(3)
    expect(gradeBandIndex(6)).toBe(3)
    expect(gradeBandIndex(7)).toBe(4)
    expect(gradeBandIndex(100)).toBe(4)
  })
})

describe('segmentIndexAtDistance（距离 → 分段下标）', () => {
  it('命中区间返回对应下标，边界外取最近分段', () => {
    const segments = buildSegmentsFrom(makeTwoClimbRecords())
    // 平路 1(0-1000)=0 / 爬坡 1(1000-2000)=1 / 平路 2(2000-3000)=2 / 爬坡 2(3000-4000)=3 / 平路 3(4000-5000)=4
    expect(segmentIndexAtDistance(segments, 500)).toBe(0)
    expect(segmentIndexAtDistance(segments, 1250)).toBe(1)
    expect(segmentIndexAtDistance(segments, 3500)).toBe(3)
    // 浮点余隙：略超终点取最近分段
    expect(segmentIndexAtDistance(segments, 5200)).toBe(4)
    expect(segmentIndexAtDistance([], 100)).toBeUndefined()
  })
})

describe('buildSegmentProfile（剖面数据）', () => {
  it('无坐标记录返回 null（无法构建剖面）', () => {
    const records = makeNoCoordRecords()
    expect(buildSegmentProfile(records, buildSegmentsFrom(records))).toBeNull()
  })

  it('单爬坡：4.5% 全程落入中坡档（alt3），末点坡度沿用前段', () => {
    const records = makeSingleClimbRecords()
    const segments = buildSegmentsFrom(records)
    const profile = buildSegmentProfile(records, segments)

    expect(profile).not.toBeNull()
    expect(profile?.points).toHaveLength(21)
    // 每个点都归属中坡档（alt3），其余档位为空
    for (const point of profile?.points ?? []) {
      expect(point.alt3).toBe(point.altitude)
      expect(point.alt0).toBeUndefined()
      expect(point.alt4).toBeUndefined()
      expect(point.segmentIndex).toBe(0)
    }
    // 末点坡度沿用前一段（4.5%）
    expect(profile?.points[20].grade).toBeCloseTo(4.5, 1)
  })

  it('双爬坡：陡坡档着色爬坡段、下坡段落入下坡档，分段下标正确', () => {
    const records = makeTwoClimbRecords()
    const segments = buildSegmentsFrom(records)
    const profile = buildSegmentProfile(records, segments)

    expect(profile).not.toBeNull()
    // 爬坡 1 段内点（1250m）归属陡坡档（10%）且分段下标为 1
    const climbPoint = profile?.points.find((point) => point.x === 1250)
    expect(climbPoint?.alt4).toBe(125)
    expect(climbPoint?.segmentIndex).toBe(1)
    // 下坡段（2500m，-5%）归属下坡档
    const descentPoint = profile?.points.find((point) => point.x === 2500)
    expect(descentPoint?.alt0).toBe(175)
    // 相邻档位在边界点衔接：2000m 点同属陡坡（爬坡 1 末端）与下坡（下坡起点）
    const boundaryPoint = profile?.points.find((point) => point.x === 2000)
    expect(boundaryPoint?.alt4).toBe(200)
    expect(boundaryPoint?.alt0).toBe(200)
  })

  it('UCI 徽章：锚点为爬坡段内峰值剖面点（单爬坡 2km × 4.5% = 9000 → 4 级）', () => {
    const records = makeSingleClimbRecords()
    const segments = buildSegmentsFrom(records)
    const profile = buildSegmentProfile(records, segments)

    expect(profile?.badges).toHaveLength(1)
    expect(profile?.badges[0]).toEqual({ segmentIndex: 0, level: 4, x: 2000, y: 190 })
  })

  it('剖面点数超过上限时均匀抽稀到上限内（保留首尾，性能封顶）', () => {
    // 1000 个点：纬度交替抖动（≈55m）使 Douglas-Peucker 全保留，触发封顶抽稀
    const records = Array.from({ length: 1000 }, (_, index) => ({
      timestamp: index * 10,
      latitude: 31.2 + index * 0.0001 + (index % 2) * 0.0005,
      longitude: 121.5 + index * 0.0001,
      altitude: 100 + Math.sin(index / 20) * 30,
      distance: index * 10,
    }))
    const segments = buildSegmentsFrom(records)
    const profile = buildSegmentProfile(records, segments)

    expect(profile).not.toBeNull()
    expect(profile?.points.length).toBeLessThanOrEqual(MAX_PROFILE_POINTS)
    // 首尾点保留（剖面覆盖全程）
    expect(profile?.points[0].x).toBe(0)
    expect(profile?.points[profile!.points.length - 1].x).toBe(9990)
  })
})

describe('爬坡与分段分析区块（Recharts 剖面图）', () => {
  it('渲染剖面摘要、坐标轴刻度与色阶图例（无分段卡片列表）', () => {
    mockChartLayout()
    const { container } = render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText('爬坡与分段分析')).toBeInTheDocument()
    // 摘要：爬坡/平路计数
    expect(screen.getByText(/共 2 段爬坡、3 段平路/)).toBeInTheDocument()
    // Recharts 图表骨架（距离轴刻度 + 曲线 + 分段色带）
    expect(container.querySelector('.segments-section__chart .recharts-surface')).not.toBeNull()
    expect(container.querySelectorAll('.recharts-cartesian-axis-tick').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.recharts-line-curve').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.recharts-reference-area').length).toBeGreaterThan(0)
    // 坡度色阶图例
    expect(container.querySelector('.segments-section__legend')).not.toBeNull()
    // 未悬停时不显示悬浮卡，且不再渲染分段卡片列表
    expect(container.querySelector('[data-testid="segment-tooltip"]')).toBeNull()
    expect(container.querySelector('.segment-list')).toBeNull()
  })

  it('剖面折线按坡度着色（10% 爬坡段为陡坡红线），UCI 徽章渲染级别文本', () => {
    mockChartLayout()
    const { container } = render(<SegmentsSection records={makeSingleClimbRecords()} distanceUnit="km" />)

    // 陡坡红（#ef4444）曲线存在
    const redCurve = Array.from(
      container.querySelectorAll('.recharts-line-curve'),
    ).find((path) => path.getAttribute('stroke') === '#ef4444')
    expect(redCurve).toBeDefined()
    // UCI 徽章：2km × 4.5% = 9000 → 4 级
    expect(screen.getAllByText('4 级').length).toBeGreaterThan(0)
    // 图例
    expect(container.querySelector('.segments-section__legend')).not.toBeNull()
  })

  it('悬停剖面：Tooltip 显示分段详情（含区间/爬升/坡度/此处海拔/速度/功率/心率）并高亮色带', async () => {
    mockChartLayout()
    const onHover = vi.fn()
    const { container } = render(
      <SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" onHover={onHover} />,
    )
    const wrapper = container.querySelector('.recharts-wrapper') as Element

    // 悬停到约 30% 宽处（≈1500m，落在爬坡 1 段内）。
    // recharts 3 默认 raf 节流 mousemove，需等待一帧后再断言
    fireEvent.mouseMove(wrapper, { clientX: 270, clientY: 110 })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="segment-tooltip"]')).not.toBeNull()
    })

    const tooltip = container.querySelector('[data-testid="segment-tooltip"]') as Element
    // 悬浮卡标题为当前分段标签
    expect(tooltip).toHaveTextContent('爬坡 1')
    // 区间与长度行
    expect(tooltip).toHaveTextContent('区间')
    expect(tooltip).toHaveTextContent('1.00 km – 2.00 km')
    expect(tooltip).toHaveTextContent('长度')
    expect(tooltip).toHaveTextContent('1.00 km')
    // 爬坡段特有行：爬升 100m、坡度 10.0%
    expect(tooltip).toHaveTextContent('爬升')
    expect(tooltip).toHaveTextContent('100 m')
    expect(tooltip).toHaveTextContent('坡度')
    expect(tooltip).toHaveTextContent('10.0%')
    // 此处海拔/此处坡度（悬停点 1500m）
    expect(tooltip).toHaveTextContent('此处海拔')
    expect(tooltip).toHaveTextContent('150 m')
    expect(tooltip).toHaveTextContent('此处坡度')
    // 强度指标行（速度 4 m/s → 14.4 km/h、功率 200W、心率 150bpm）
    expect(tooltip).toHaveTextContent('14.4 km/h')
    expect(tooltip).toHaveTextContent('200 W')
    expect(tooltip).toHaveTextContent('150 bpm')
    // 共享时间轴：上报悬停点时间戳
    expect(onHover).toHaveBeenCalledWith(expect.any(Number))
    // 悬停分段色带加深（爬坡激活填充色出现）
    expect(container.querySelector('.segments-section__chart')?.innerHTML).toContain(
      'rgba(249, 115, 22, 0.42)',
    )

    // 移出图表：悬浮卡消失并上报 undefined
    fireEvent.mouseLeave(wrapper)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="segment-tooltip"]')).toBeNull()
    })
    expect(onHover).toHaveBeenLastCalledWith(undefined)
  })

  it('外部悬停时间戳渲染参考线（共享时间轴联动）', () => {
    mockChartLayout()
    const { container, rerender } = render(
      <SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" hoverTimestamp={150} />,
    )

    // 有外部时间戳时参考线出现
    expect(container.querySelector('.recharts-reference-line')).not.toBeNull()

    // 无悬停时间戳时不渲染参考线
    rerender(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)
    expect(container.querySelector('.recharts-reference-line')).toBeNull()
  })

  it('渲染相邻爬坡对比洞察', () => {
    mockChartLayout()
    render(<SegmentsSection records={makeTwoClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText(/爬坡 2比爬坡 1/)).toBeInTheDocument()
    expect(screen.getByText(/平均功率高/)).toBeInTheDocument()
    expect(screen.getByText(/但速度低/)).toBeInTheDocument()
  })

  it('无爬坡时不渲染区块', () => {
    render(<SegmentsSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('爬坡与分段分析')).toBeNull()
  })
})
