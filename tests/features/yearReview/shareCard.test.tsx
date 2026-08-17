/**
 * 年度分享图测试（后续工作项：社交分享）。
 *
 * buildShareCardModel 纯函数验证格式化口径（千分位/单位换算/小时）；
 * ShareCardModal 用 canvas stub 验证绘制调用、Esc/按钮关闭、PNG 下载链路。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShareCardModal from '@/features/yearReview/ShareCardModal'
import { buildShareCardModel } from '@/features/yearReview/shareCard'
import type { StatisticsMetrics } from '@/features/statistics/statistics'
import type { MonthlyDistance } from '@/features/yearReview/yearReview'

/** 年度指标样例：42 次 / 3214.5 km / 128.5 小时 / 12340 米 */
const METRICS: StatisticsMetrics = {
  count: 42,
  totalDistance: 3_214_500,
  totalDuration: 462_600,
  totalElevationGain: 12_340,
  avgRideDistance: 76_536,
  avgSpeed: 6.9,
  longestRide: 210_000,
  maxElevationGain: 1500,
  maxSpeed: 15,
  maxPower: 800,
}

/** 12 个月距离样例（米），7 月最高 */
const MONTHS: MonthlyDistance[] = Array.from({ length: 12 }, (_, index) => ({
  month: index + 1,
  distance: index === 6 ? 400_000 : 100_000 + index * 10_000,
  count: 4,
}))

describe('buildShareCardModel', () => {
  it('公制：四项指标与月度距离按 km 换算', () => {
    const model = buildShareCardModel(2026, METRICS, MONTHS, 'km')
    expect(model.year).toBe(2026)
    expect(model.stats).toEqual([
      { label: '骑行次数', value: '42 次' },
      { label: '总距离', value: '3214.50 km' },
      { label: '总时长', value: '128.5 小时' },
      { label: '总爬升', value: '12,340 米' },
    ])
    expect(model.monthlyDistances).toHaveLength(12)
    expect(model.monthlyDistances[6]).toBe(400)
    expect(model.unitLabel).toBe('km')
  })

  it('英制：月度距离按 mi 换算', () => {
    const model = buildShareCardModel(2026, METRICS, MONTHS, 'mi')
    expect(model.unitLabel).toBe('mi')
    expect(model.monthlyDistances[6]).toBeCloseTo(400_000 / 1609.344, 5)
    expect(model.stats[1].value).toBe(`${(3_214_500 / 1609.344).toFixed(2)} mi`)
  })
})

describe('ShareCardModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** canvas 2d 上下文 stub：记录调用，属性可随意赋值 */
  function stubCanvasContext() {
    const stub = {
      beginPath: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      moveTo: vi.fn(),
      scale: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      stub as unknown as CanvasRenderingContext2D,
    )
    return stub
  }

  it('打开弹窗绘制分享图（年份写入画布）', () => {
    const ctx = stubCanvasContext()
    render(
      <ShareCardModal
        distanceUnit="km"
        metrics={METRICS}
        months={MONTHS}
        onClose={() => {}}
        year={2026}
      />,
    )
    expect(screen.getByRole('dialog', { name: '年度分享图' })).toBeInTheDocument()
    expect(ctx.fillText).toHaveBeenCalledWith('2026', expect.any(Number), expect.any(Number))
  })

  it('Esc 与关闭按钮触发 onClose', async () => {
    stubCanvasContext()
    const onClose = vi.fn()
    render(
      <ShareCardModal
        distanceUnit="km"
        metrics={METRICS}
        months={MONTHS}
        onClose={onClose}
        year={2026}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('下载 PNG：toBlob → createObjectURL → 触发下载', async () => {
    stubCanvasContext()
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))

    render(
      <ShareCardModal
        distanceUnit="km"
        metrics={METRICS}
        months={MONTHS}
        onClose={() => {}}
        year={2026}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '下载 PNG' }))
    expect(toBlob).toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
