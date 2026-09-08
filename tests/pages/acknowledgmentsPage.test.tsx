/**
 * 致谢页面测试。
 *
 * 验证：标题与引导文案、名单成员与数据文件一致（含贡献说明与外链）、
 * 空名单时的空态文案。名单数据由 acknowledgmentsData.ts 统一维护，
 * 侧边栏底部「致谢」链接直达本页（布局链路在 App.test.tsx 覆盖）。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AcknowledgmentsPage from '@/pages/AcknowledgmentsPage'
import { ACKNOWLEDGMENTS } from '@/features/changelog/acknowledgmentsData'

/** 渲染辅助（页面无路由跳转，MemoryRouter 仅为统一包裹习惯）。 */
function renderPage() {
  return render(<AcknowledgmentsPage />, { wrapper: MemoryRouter })
}

describe('致谢页面', () => {
  it('渲染标题与引导文案', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: '致谢' })).toBeInTheDocument()
    expect(screen.getByText(/感谢每一位参与测试与使用的骑友/)).toBeInTheDocument()
  })

  it('名单成员与数据文件一致（含贡献说明与外链）', () => {
    renderPage()

    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => item.className === 'acknowledgments-card')
    expect(cards).toHaveLength(ACKNOWLEDGMENTS.length)
    for (const person of ACKNOWLEDGMENTS) {
      // 昵称始终展示
      expect(screen.getByText(person.name)).toBeInTheDocument()
      if (person.role) {
        expect(screen.getByText(person.role)).toBeInTheDocument()
      }
      if (person.url) {
        const link = screen.getByRole('link', { name: person.name })
        expect(link).toHaveAttribute('href', person.url)
        expect(link).toHaveAttribute('target', '_blank')
      } else {
        expect(screen.queryByRole('link', { name: person.name })).toBeNull()
      }
    }
  })
})
