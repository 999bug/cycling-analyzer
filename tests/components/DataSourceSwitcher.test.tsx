/**
 * 数据源切换器组件测试（规格见 docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md §6）。
 *
 * 两档分段控件：作者数据（只读快照）/ 我的数据（本地 IndexedDB）。
 * 作者名来自 store authorName（回退「作者」）；快照不可用时作者档禁用。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import DataSourceSwitcher from '@/components/DataSourceSwitcher'
import { useDataSourceStore } from '@/stores/dataSourceStore'

describe('DataSourceSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
  })

  it('渲染两档，作者档带作者名', () => {
    render(<DataSourceSwitcher />)
    expect(screen.getByRole('group', { name: '数据源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Saul 的数据/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我的数据' })).toBeInTheDocument()
  })

  it('作者名缺失时回退「作者」', () => {
    useDataSourceStore.setState({ authorName: null })
    render(<DataSourceSwitcher />)
    expect(screen.getByRole('button', { name: /作者的数据/ })).toBeInTheDocument()
  })

  it('aria-pressed 反映当前选择', () => {
    render(<DataSourceSwitcher />)
    expect(screen.getByRole('button', { name: /Saul 的数据/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '我的数据' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('点击切换数据源', async () => {
    const user = userEvent.setup()
    render(<DataSourceSwitcher />)
    await user.click(screen.getByRole('button', { name: '我的数据' }))
    expect(useDataSourceStore.getState().source).toBe('local')
    await user.click(screen.getByRole('button', { name: /Saul 的数据/ }))
    expect(useDataSourceStore.getState().source).toBe('author')
  })

  it('快照不可用时作者档禁用', () => {
    useDataSourceStore.setState({ authorAvailable: false })
    render(<DataSourceSwitcher />)
    expect(screen.getByRole('button', { name: /作者的数据|Saul 的数据/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '我的数据' })).toBeEnabled()
  })
})
