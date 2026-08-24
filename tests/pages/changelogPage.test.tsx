/**
 * 更新日志页面测试。
 *
 * 验证：时间线渲染版本条目（倒序）、功能列表展示、当前版本徽章高亮、
 * 侧边栏版本号链接跳转（AppLayout 集成在布局测试中，此处测页面本体）。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ChangelogPage from '@/pages/ChangelogPage'
import { CHANGELOG } from '@/features/changelog/changelogData'

/** 渲染辅助（MemoryRouter 包裹）。 */
function renderPage() {
  return render(<ChangelogPage />, { wrapper: MemoryRouter })
}

describe('更新日志页面', () => {
  it('渲染标题与引导文案', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: '更新日志' })).toBeInTheDocument()
    expect(screen.getByText(/每个版本新增了什么功能/)).toBeInTheDocument()
  })

  it('渲染全部版本条目且最新在前', () => {
    renderPage()

    const items = screen.getAllByRole('listitem').filter((item) => item.className === 'changelog-item')
    expect(items).toHaveLength(CHANGELOG.length)
    // 倒序：第一个条目 = 数据首项（最新版本）
    expect(items[0]).toHaveTextContent(`v${CHANGELOG[0].version}`)
    expect(items[items.length - 1]).toHaveTextContent(`v${CHANGELOG[CHANGELOG.length - 1].version}`)
  })

  it('当前版本高亮「当前版本」徽章，其余版本无徽章', () => {
    renderPage()

    // 当前运行版本 = package.json version = changelog 最新条目
    expect(screen.getByText('当前版本')).toBeInTheDocument()
    expect(screen.getAllByText('当前版本')).toHaveLength(1)
  })

  it('功能列表逐条展示', () => {
    renderPage()

    // 抽查 2.12.0 的功能描述
    expect(screen.getByText(/赛段卡片展开完整成绩排行列表/)).toBeInTheDocument()
    expect(screen.getByText(/有氧效率趋势/)).toBeInTheDocument()
  })
})
