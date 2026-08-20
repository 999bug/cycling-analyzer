/**
 * 功率曲线图测试（规格 §39 P2）：组件渲染空态与有数据态。
 * 曲线计算本身的口径由 tests/features/analysis/powerCurve.test.ts 覆盖。
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import PowerCurveChart from '@/charts/PowerCurveChart'

/**
 * 生成等间隔功率记录。
 *
 * @param powers 功率序列
 */
function makeRecords(powers: readonly number[]): ActivityRecord[] {
  return powers.map((power, index) => ({ timestamp: 1000 + index, power }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PowerCurveChart', () => {
  it('无功率数据时整区块隐藏（不渲染）', () => {
    render(<PowerCurveChart records={[{ timestamp: 1 }]} />)

    expect(screen.queryByText('功率曲线')).toBeNull()
    expect(screen.queryByText('该活动没有功率数据')).toBeNull()
  })

  it('有功率数据时渲染标题且隐藏空态', () => {
    // jsdom 中 getBoundingClientRect 恒为 0，mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    const records = makeRecords(new Array<number>(100).fill(200))
    render(<PowerCurveChart records={records} />)

    expect(screen.getByText('功率曲线')).toBeInTheDocument()
    expect(screen.queryByText('该活动没有功率数据')).not.toBeInTheDocument()
  })
})
