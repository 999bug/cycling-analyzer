/**
 * 侧边栏致谢区块测试。
 *
 * 验证：标题与「更多」链接直达更新日志、成员徽章与数据文件一致
 * （含贡献说明 title 悬停与带链接成员外链）、空名单时不渲染占位。
 * 数据文件为静态常量，一致性与更新日志页测试同风格（数据驱动遍历）。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SidebarCredits from '@/components/SidebarCredits'
import { ACKNOWLEDGMENTS } from '@/features/changelog/acknowledgmentsData'

/** 渲染辅助（MemoryRouter 包裹，「更多」为 react-router Link）。 */
function renderComponent() {
  return render(<SidebarCredits />, { wrapper: MemoryRouter })
}

describe('侧边栏致谢区块', () => {
  it('渲染标题与「更多」链接（直达更新日志）', () => {
    renderComponent()

    expect(screen.getByRole('heading', { name: '致谢' })).toBeInTheDocument()
    const more = screen.getByRole('link', { name: '更多' })
    expect(more).toHaveAttribute('href', '/changelog')
  })

  it('成员徽章与数据文件一致（含贡献说明与外链）', () => {
    renderComponent()

    const badges = screen
      .getAllByRole('listitem')
      .filter((item) => item.textContent !== null)
    expect(badges).toHaveLength(ACKNOWLEDGMENTS.length)
    for (const person of ACKNOWLEDGMENTS) {
      const badge = screen.getByText(person.name)
      expect(badge).toBeInTheDocument()
      if (person.role) {
        expect(badge).toHaveAttribute('title', person.role)
      }
      if (person.url) {
        expect(badge.closest('a')).toHaveAttribute('href', person.url)
        expect(badge.closest('a')).toHaveAttribute('target', '_blank')
      } else {
        expect(badge.closest('a')).toBeNull()
      }
    }
  })
})
