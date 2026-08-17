/**
 * 无障碍（a11y）定向测试（后续工作项：a11y 审查）。
 *
 * 覆盖本轮审查的改进点：
 * 1. 列表标题列渲染为真实链接（屏幕阅读器/键盘有明确详情入口）
 * 2. 图表横轴切换按钮 aria-pressed 状态
 * 3. 布局 skip link → #main-content
 * 4. 导入面板 toggle aria-expanded 状态切换
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ActivityListTable from '@/features/activity/ActivityListTable'
import MetricChart from '@/charts/MetricChart'
import AppLayout from '@/layouts/AppLayout'
import ImportPanel from '@/features/import/ImportPanel'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/** 构造摘要（仅测试所需字段） */
function makeSummary(id: string): ActivitySummary {
  return {
    id,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-01T08:00:00',
    endTime: '2026-08-01T09:00:00',
    duration: 3600,
    elapsedTime: 3600,
    distance: 30000,
    elevationGain: 200,
  }
}

describe('列表标题列真实链接', () => {
  it('标题渲染为指向详情页的链接，点击不触发行回调', async () => {
    const onRowClick = vi.fn()
    render(
      <ActivityListTable
        items={[makeSummary('act-1')]}
        sortBy="startTime"
        sortOrder="desc"
        onSortChange={() => undefined}
        onRowClick={onRowClick}
      />,
      { wrapper: MemoryRouter },
    )

    const link = screen.getByRole('link', { name: '2026-08-01 骑行' })
    expect(link).toHaveAttribute('href', '/activities/act-1')
    // stopPropagation：点击链接不重复触发行点击回调
    await userEvent.click(link)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('图表横轴切换按钮', () => {
  it('aria-pressed 随选中状态切换', async () => {
    // jsdom 无布局测量：mock 容器尺寸让 Recharts 正常渲染
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 220,
    } as DOMRect)
    render(
      <MetricChart
        title="速度"
        metric="speed"
        meta={{ color: '#4f8cff', unit: 'km/h' }}
        records={[
          { timestamp: 0, speed: 8, distance: 0 },
          { timestamp: 10, speed: 9, distance: 85 },
        ]}
        switchable
      />,
    )

    const distanceButton = screen.getByRole('button', { name: '距离' })
    const timeButton = screen.getByRole('button', { name: '时间' })
    expect(distanceButton).toHaveAttribute('aria-pressed', 'true')
    expect(timeButton).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(timeButton)
    expect(distanceButton).toHaveAttribute('aria-pressed', 'false')
    expect(timeButton).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('布局 skip link', () => {
  it('提供跳转主内容链接，主内容区带 #main-content', () => {
    const { container } = render(<AppLayout />, { wrapper: MemoryRouter })

    const skipLink = screen.getByRole('link', { name: '跳转到主内容' })
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(container.querySelector('main#main-content')).not.toBeNull()
  })
})

describe('导入面板 toggle', () => {
  it('aria-expanded 随展开状态切换', async () => {
    render(<ImportPanel />)

    const toggle = screen.getByRole('button', { name: '同步骑行数据' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
