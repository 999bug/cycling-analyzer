/**
 * 新版本更新提示条组件测试：展示条件 / 立即更新触发 /
 * 更新中禁用 / 稍后隐藏 / 无新版本不渲染。
 *
 * useSWUpdate 依赖 virtual:pwa-register/react 虚拟模块，
 * 统一 mock 掉以控制 needRefresh 状态与 updateServiceWorker 间谍。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateBanner from '@/components/UpdateBanner'

/** updateServiceWorker 间谍（跨用例共享，beforeEach 重置 mock 实现） */
const updateServiceWorkerSpy = vi.fn()

/** mock useRegisterSW 当前返回的 needRefresh 状态（默认无新版本） */
let mockNeedRefresh = false

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [mockNeedRefresh, vi.fn()],
    updateServiceWorker: updateServiceWorkerSpy,
  }),
}))

beforeEach(() => {
  mockNeedRefresh = false
  updateServiceWorkerSpy.mockReset()
})

describe('UpdateBanner', () => {
  it('无新版本时不渲染', () => {
    const { container } = render(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('新版本就绪时展示醒目提示条，含标题与引导文案', () => {
    mockNeedRefresh = true
    render(<UpdateBanner />)

    expect(screen.getByRole('alert', { name: '新版本已就绪' })).toBeInTheDocument()
    expect(screen.getByText('新版本已就绪')).toBeInTheDocument()
    expect(screen.getByText(/点击「立即更新」刷新到最新版/)).toBeInTheDocument()
  })

  it('点击「立即更新」触发 updateServiceWorker(true)（新 SW 接管后自动刷新）', async () => {
    const user = userEvent.setup()
    mockNeedRefresh = true
    render(<UpdateBanner />)

    await user.click(screen.getByRole('button', { name: '立即更新' }))

    expect(updateServiceWorkerSpy).toHaveBeenCalledWith(true)
  })

  it('更新请求发出后按钮禁用并显示「更新中…」，防重复点击', async () => {
    const user = userEvent.setup()
    mockNeedRefresh = true
    render(<UpdateBanner />)

    await user.click(screen.getByRole('button', { name: '立即更新' }))

    expect(screen.getByRole('button', { name: '更新中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '稍后' })).toBeDisabled()
    // 更新进行中不允许重复触发
    expect(updateServiceWorkerSpy).toHaveBeenCalledTimes(1)
  })

  it('点击「稍后」隐藏提示条（仅本次会话，下次加载重新出现）', async () => {
    const user = userEvent.setup()
    mockNeedRefresh = true
    render(<UpdateBanner />)

    await user.click(screen.getByRole('button', { name: '稍后' }))

    expect(screen.queryByRole('alert', { name: '新版本已就绪' })).not.toBeInTheDocument()
    expect(updateServiceWorkerSpy).not.toHaveBeenCalled()
  })
})
