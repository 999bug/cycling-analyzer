/**
 * 真实界面分享卡测试（ShareStageCard）。
 *
 * 卡片即「真实界面截屏」：断言真实品牌 logo、真实指标（含单位）、图上文字、
 * 页脚都在，且嵌进去的地图是静态视图（不带全屏/缩放/底图模式等交互控件，
 * 拖拽把手也不出现——这些控件不能进成片）。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShareStageCard from '@/features/share/ShareStageCard'
import { buildShareData } from '@/features/share/shareData'
import type { Activity, RoutePoint } from '@/types/activity'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    startTime: '2026-09-06T07:30:00+08:00',
    endTime: '2026-09-06T12:00:00+08:00',
    duration: 4 * 3600 + 12 * 60,
    elapsedTime: 4.5 * 3600,
    distance: 108_400,
    elevationGain: 1268,
    avgSpeed: 25.8 / 3.6,
    name: '周末长距离',
    bikeName: 'Giant TCR',
    ...overrides,
  }
}

const ROUTE: RoutePoint[] = [
  { timestamp: 0, latitude: 31.2, longitude: 121.5 },
  { timestamp: 60, latitude: 31.21, longitude: 121.51 },
  { timestamp: 120, latitude: 31.22, longitude: 121.52 },
]

/**
 * 渲染分享舞台。
 *
 * @param overrides 活动字段覆盖
 */
function renderStage(overrides: Partial<Activity> = {}) {
  const activity = makeActivity(overrides)
  const data = buildShareData(activity, [], { distanceUnit: 'km' })
  return render(
    <ShareStageCard
      activity={activity}
      data={data}
      routePoints={ROUTE}
      titleText="周末长距离"
      scriptText="9 月 6 日，骑了 108.4 公里，爬升 1268 米。"
    />,
  )
}

describe('ShareStageCard 真实界面分享卡', () => {
  it('渲染品牌 logo、日期、骑行类型与副标题', () => {
    const { container } = renderStage()

    const logo = container.querySelector('.share-stage__logo') as HTMLImageElement
    expect(logo.getAttribute('src')).toContain('qileme.png')
    expect(screen.getByText('2026 年 9 月 6 日')).toBeInTheDocument()
    expect(screen.getByText('周末长距离')).toBeInTheDocument()
    // 副标题 = 自动标题行（真实数据拼装）
    expect(screen.getByText(/108.4 km骑行/)).toBeInTheDocument()
  })

  it('指标取真实数据，长度/速度类单位跟在数值后，时长不带单位', () => {
    const { container } = renderStage()

    const cards = Array.from(container.querySelectorAll('.share-stage__stat'))
    expect(cards).toHaveLength(4)
    const values = cards.map((card) => card.querySelector('.share-stage__stat-value')?.textContent)
    expect(values[0]).toContain('108.4')
    expect(values[0]).toContain('km')
    // 时长（h:mm）：单位不拼到值后
    expect(values[1]).toContain('4:12')
    expect(values[1]).not.toContain('h:mm')
    expect(values[2]).toContain('1268')

    const labels = cards.map((card) => card.querySelector('.share-stage__stat-label')?.textContent)
    expect(labels).toEqual(['距离', '时长', '爬升', '均速'])
  })

  it('图上文案与页脚（车型 / 隐私承诺）在卡片上', () => {
    renderStage()

    expect(screen.getByText('9 月 6 日，骑了 108.4 公里，爬升 1268 米。')).toBeInTheDocument()
    expect(screen.getByText('本地解析 · 数据不出浏览器')).toBeInTheDocument()
    expect(screen.getByText('Giant TCR')).toBeInTheDocument()
  })

  it('没有车型时页脚回退品牌名', () => {
    renderStage({ bikeName: undefined })

    expect(screen.getByText('骑了么')).toBeInTheDocument()
  })

  it('地图是静态视图：无全屏按钮、无缩放控件、无底图模式角标、无拖拽把手', () => {
    const { container } = renderStage()

    expect(container.querySelector('.activity-map-wrapper--static')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '全屏查看' })).toBeNull()
    expect(container.querySelector('.map-resize-handle')).toBeNull()
    expect(container.querySelector('.map-mode-switcher')).toBeNull()
    expect(container.querySelector('.leaflet-control-zoom')).toBeNull()
  })

  it('无轨迹时地图给出占位而不是空白或伪造轨迹', () => {
    const activity = makeActivity()
    const data = buildShareData(activity, [], { distanceUnit: 'km' })
    render(
      <ShareStageCard
        activity={activity}
        data={data}
        routePoints={[]}
        titleText="周末长距离"
        scriptText=""
      />,
    )

    expect(screen.getByText('该活动没有坐标轨迹')).toBeInTheDocument()
  })
})
