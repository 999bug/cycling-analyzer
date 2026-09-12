/**
 * 示例数据说明条组件测试。
 *
 * 仅有效源为作者时显示：说明当前是站点内置的示例数据（不出现作者身份），
 * 提供导入入口并支持关闭；关闭状态持久化在 dataSourceStore，设置页可恢复。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import AuthorBanner from '@/components/AuthorBanner'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import { useImportStore } from '@/stores/importStore'

describe('AuthorBanner', () => {
  beforeEach(() => {
    useDataSourceStore.setState({
      source: 'author',
      authorAvailable: true,
      authorName: 'Saul',
      authorBannerDismissed: false,
    })
    useImportStore.setState({ dialogOpen: false })
  })

  it('作者模式显示说明条且标注为示例数据', () => {
    render(<AuthorBanner />)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('示例数据')
    expect(banner).toHaveTextContent('导入你的 FIT 文件后，这里会立刻换成你自己的数据')
  })

  it('本地模式不渲染', () => {
    useDataSourceStore.setState({ source: 'local' })
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('快照不可用时（有效源回退本地）不渲染', () => {
    useDataSourceStore.setState({ authorAvailable: false })
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('点「导入我的数据」打开导入弹窗', async () => {
    const user = userEvent.setup()
    render(<AuthorBanner />)
    await user.click(screen.getByRole('button', { name: '导入我的数据' }))
    expect(useImportStore.getState().dialogOpen).toBe(true)
  })

  it('点关闭后消失并写入关闭记忆', async () => {
    const user = userEvent.setup()
    render(<AuthorBanner />)
    await user.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(useDataSourceStore.getState().authorBannerDismissed).toBe(true)
  })

  it('已关闭时不再显示', () => {
    useDataSourceStore.setState({ authorBannerDismissed: true })
    const { container } = render(<AuthorBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
