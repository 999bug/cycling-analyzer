/**
 * 成就区块组件测试。
 *
 * - 渲染成就徽章（纪录名/本次值/原纪录），值随单位偏好换算；
 * - 无成就时区块不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AchievementsSection from '@/features/activity/AchievementsSection'
import type { Achievement } from '@/features/activity/achievements'

const ACHIEVEMENTS: Achievement[] = [
  { key: 'distance', label: '最远骑行', value: 45_200, previousBest: 40_100 },
  { key: 'elevationGain', label: '最多爬升', value: 830, previousBest: 612 },
]

describe('成就区块', () => {
  it('渲染成就徽章：纪录名、本次值与原纪录', () => {
    render(<AchievementsSection achievements={ACHIEVEMENTS} distanceUnit="km" />)

    expect(screen.getByRole('region', { name: '本次成就' })).toBeInTheDocument()
    expect(screen.getByText('最远骑行')).toBeInTheDocument()
    expect(screen.getByText('45.20 km')).toBeInTheDocument()
    expect(screen.getByText('原纪录 40.10 km')).toBeInTheDocument()
    expect(screen.getByText('最多爬升')).toBeInTheDocument()
    expect(screen.getByText('+830 m')).toBeInTheDocument()
    expect(screen.getByText('原纪录 +612 m')).toBeInTheDocument()
  })

  it('距离随单位偏好换算（英里）', () => {
    render(
      <AchievementsSection
        achievements={[ACHIEVEMENTS[0]]}
        distanceUnit="mi"
      />,
    )

    expect(screen.getByText('28.09 mi')).toBeInTheDocument()
    expect(screen.getByText('原纪录 24.92 mi')).toBeInTheDocument()
  })

  it('时长成就按时长格式渲染', () => {
    render(
      <AchievementsSection
        achievements={[{ key: 'duration', label: '最长骑行', value: 5400, previousBest: 3600 }]}
        distanceUnit="km"
      />,
    )

    expect(screen.getByText('最长骑行')).toBeInTheDocument()
    expect(screen.getByText('01:30:00')).toBeInTheDocument()
  })

  it('无成就时区块不渲染', () => {
    const { container } = render(
      <AchievementsSection achievements={[]} distanceUnit="km" />,
    )

    expect(container.firstChild).toBeNull()
  })
})
