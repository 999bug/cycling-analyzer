/**
 * 训练效果区块测试。
 *
 * - 渲染有氧/无氧两行：数值（1 位小数）+ 分档文案 + 进度条比例；
 * - 分档函数覆盖 Garmin 口径各档；
 * - 单项缺失显示 '—'；两项均缺失时区块不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TrainingEffectSection from '@/features/activity/TrainingEffectSection'
import { describeTrainingEffect } from '@/features/activity/trainingEffect'

describe('describeTrainingEffect 分档', () => {
  it('覆盖 Garmin 口径各档', () => {
    expect(describeTrainingEffect(0.5)).toBe('无效果')
    expect(describeTrainingEffect(1.0)).toBe('恢复')
    expect(describeTrainingEffect(2.5)).toBe('维持')
    expect(describeTrainingEffect(3.2)).toBe('改善')
    expect(describeTrainingEffect(4.5)).toBe('大幅提高')
    expect(describeTrainingEffect(5.0)).toBe('极限')
  })
})

describe('训练效果区块', () => {
  it('渲染有氧/无氧数值、分档文案与进度条比例', () => {
    render(<TrainingEffectSection aerobic={4.2} anaerobic={1.8} />)

    expect(screen.getByText('4.2 大幅提高')).toBeInTheDocument()
    expect(screen.getByText('1.8 恢复')).toBeInTheDocument()
    // 进度条比例：值 / 5
    const aerobicBar = screen.getByRole('progressbar', { name: '有氧效果' })
    expect(aerobicBar).toHaveAttribute('aria-valuenow', '4.2')
    expect(aerobicBar.querySelector('.training-effect__bar-fill')).toHaveStyle({ width: '84%' })
  })

  it('单项缺失时该项显示 —，另一项正常', () => {
    render(<TrainingEffectSection aerobic={undefined} anaerobic={2.6} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('2.6 维持')).toBeInTheDocument()
  })

  it('两项均缺失时区块不渲染', () => {
    const { container } = render(
      <TrainingEffectSection aerobic={undefined} anaerobic={undefined} />,
    )

    expect(container.firstChild).toBeNull()
  })
})
