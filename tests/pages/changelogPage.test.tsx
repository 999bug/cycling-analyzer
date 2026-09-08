/**
 * 更新日志页面测试。
 *
 * 验证：时间线渲染版本条目（倒序）、功能列表展示、当前版本徽章高亮、
 * 底部致谢区块（标题引导/名单与数据一致/带链接成员外链）、
 * 侧边栏版本号链接跳转（AppLayout 集成在布局测试中，此处测页面本体）。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ACKNOWLEDGMENTS } from '@/features/changelog/acknowledgmentsData'
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

describe('致谢区块', () => {
  it('渲染致谢标题与引导文案', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: '致谢' })).toBeInTheDocument()
    expect(screen.getByText(/感谢每一位参与测试与使用的骑友/)).toBeInTheDocument()
  })

  it('名单成员与数据文件一致（含可选身份说明）', () => {
    renderPage()

    const items = screen
      .getAllByRole('listitem')
      .filter((item) => item.className === 'changelog-acknowledgments__item')
    expect(items).toHaveLength(ACKNOWLEDGMENTS.length)
    for (const person of ACKNOWLEDGMENTS) {
      expect(screen.getByText(person.name)).toBeInTheDocument()
      if (person.role) {
        expect(screen.getByText(person.role)).toBeInTheDocument()
      }
    }
  })

  it('带链接的成员昵称渲染为外链（名单暂无链接时作为后续数据的回归守护）', () => {
    renderPage()

    for (const person of ACKNOWLEDGMENTS.filter((item) => item.url)) {
      const link = screen.getByRole('link', { name: person.name })
      expect(link).toHaveAttribute('href', person.url)
      expect(link).toHaveAttribute('target', '_blank')
    }
  })
})
