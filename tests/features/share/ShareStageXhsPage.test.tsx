/**
 * 小红书套图（真实界面版）四页测试。
 *
 * 重点是「页面用了站内真实组件」与「缺数据不伪造」两条：
 * - 封面：结论句 + 钩子数字 + 3 指标 + 文案；
 * - 路线：静态视图地图 + 2×2 指标；
 * - 洞察：复用站内「骑行洞察」区块；无洞察给诚实空态；
 * - 图表：复用站内「数据曲线」卡片，且静态视图下不出现轴切换/指标开关按钮；无曲线数据给空态。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShareStageXhsPage from '@/features/share/ShareStageXhsPage'
import { SHARE_STAGE_PAGES } from '@/features/share/shareStagePages'
import { buildShareData } from '@/features/share/shareData'
import type { Activity, ActivityRecord, RoutePoint } from '@/types/activity'
import type { ShareStagePageId } from '@/features/share/shareStagePages'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    // 不带时区偏移 → 按本地时间解析，任何时区下都落在同一天（CI 跑 UTC）
    startTime: '2026-09-06T12:00:00',
    endTime: '2026-09-06T16:30:00',
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

/** 逐点记录：匀速 + 海拔起伏（喂给洞察与图表页） */
function makeRecords(count = 60): ActivityRecord[] {
  const records: ActivityRecord[] = []
  for (let index = 0; index <= count; index += 1) {
    records.push({
      timestamp: 1_787_000_000 + index * 30,
      latitude: 30 + index * 0.001,
      longitude: 120 + index * 0.001,
      altitude: 100 + index * 4,
      distance: index * 240,
      speed: 8,
      heartRate: 140,
    })
  }
  return records
}

const ROUTE: RoutePoint[] = [
  { timestamp: 0, latitude: 31.2, longitude: 121.5 },
  { timestamp: 60, latitude: 31.21, longitude: 121.51 },
  { timestamp: 120, latitude: 31.22, longitude: 121.52 },
]

/**
 * 渲染套图某一页。
 *
 * @param page 页标识
 * @param overrides 活动字段覆盖
 */
function renderPage(page: ShareStagePageId, overrides: Partial<Activity> = {}, records: ActivityRecord[] = []) {
  const activity = makeActivity(overrides)
  const data = buildShareData(activity, records, { distanceUnit: 'km' })
  return render(
    <ShareStageXhsPage
      page={page}
      activity={activity}
      data={data}
      routePoints={ROUTE}
      records={records}
      distanceUnit="km"
      scriptText="9 月 6 日，骑了 108.4 公里。"
    />,
  )
}

describe('小红书套图页清单', () => {
  it('四页顺序与标签与极简手绘套图一致', () => {
    expect(SHARE_STAGE_PAGES.map((item) => item.label)).toEqual(['封面', '路线', '洞察', '图表'])
  })
})

describe('封面页', () => {
  it('渲染结论句、钩子数字与 3 项次要指标', () => {
    const { container } = renderPage('cover')

    expect(container.querySelector('.share-stage__headline')?.textContent).toContain('108.4 km骑行')
    const hook = container.querySelector('.share-stage__hook-value')
    expect(hook?.textContent).toContain('108.4')
    expect(hook?.textContent).toContain('km')
    // 钩子（距离）不重复出现在次要指标里 → 3 张卡
    const cards = Array.from(container.querySelectorAll('.share-stage__stat'))
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.querySelector('.share-stage__stat-label')?.textContent)).toEqual([
      '时长',
      '爬升',
      '均速',
    ])
  })

  it('全指标缺失时钩子显示 — 且不拼单位（不编数字）', () => {
    const { container } = renderPage('cover', {
      distance: undefined,
      elevationGain: undefined,
      duration: 0,
    })

    const hook = container.querySelector('.share-stage__hook-value')
    expect(hook?.textContent).toBe('—')
  })
})

describe('路线页', () => {
  it('嵌真实地图（静态视图：无交互控件）与 2×2 指标', () => {
    const { container } = renderPage('route')

    expect(container.querySelector('.activity-map-wrapper--static')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '全屏查看' })).toBeNull()
    expect(container.querySelector('.map-resize-handle')).toBeNull()
    expect(container.querySelectorAll('.share-stage__stat')).toHaveLength(4)
  })
})

describe('洞察页', () => {
  it('复用站内「骑行洞察」区块（真实标题与条目）', () => {
    renderPage('insights', {}, makeRecords())

    expect(screen.getByRole('heading', { name: '骑行洞察' })).toBeInTheDocument()
    expect(document.querySelectorAll('.insights-item').length).toBeGreaterThan(0)
  })

  it('无洞察时给诚实空态，不渲染空区块', () => {
    const { container } = renderPage('insights', {
      distance: undefined,
      duration: 0,
      elapsedTime: undefined,
      elevationGain: undefined,
      elevationLoss: undefined,
      avgSpeed: undefined,
      avgHeartRate: undefined,
      avgPower: undefined,
      avgCadence: undefined,
      calories: undefined,
    })

    expect(screen.getByText('本次骑行暂无可呈现的洞察数据')).toBeInTheDocument()
    expect(container.querySelector('.insights-section')).toBeNull()
  })
})

describe('图表页', () => {
  it('复用站内「数据曲线」卡片，静态视图下无轴切换与指标开关', () => {
    renderPage('charts', {}, makeRecords())

    expect(screen.getByRole('heading', { name: '数据曲线' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '横轴切换' })).toBeNull()
    expect(screen.queryByRole('group', { name: '指标开关' })).toBeNull()
  })

  it('无曲线数据时给诚实空态，不渲染空图表', () => {
    const { container } = renderPage('charts')

    expect(screen.getByText('该活动没有曲线数据')).toBeInTheDocument()
    expect(container.querySelector('.chart-card')).toBeNull()
  })
})
