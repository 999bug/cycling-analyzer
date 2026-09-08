/**
 * 导入面板关闭刷新行为测试（数据变更后自动刷新需求）。
 *
 * 验证：
 * - 本次弹窗会话有新活动落库时，关闭弹窗（×/遮罩/Esc）整页刷新
 * - 无新导入（未导入或全部重复）时仅收起弹窗，不刷新
 * - 清除导入结果后关闭仍刷新（新数据已落库，标记不随 reset 撤销）
 * - 导入进行中禁止关闭（按钮禁用）
 *
 * reload 经 @/utils/navigation 间接调用（jsdom 的 location.reload 不可 stub）。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPanel from '@/features/import/ImportPanel'
import type { ImportSummary } from '@/features/import/importer'
import { useImportStore } from '@/stores/importStore'
import { reloadPage } from '@/utils/navigation'

vi.mock('@/utils/navigation', () => ({
  reloadPage: vi.fn(),
}))

/** 构造导入汇总（仅关心 newImported 字段，其余填零值） */
function makeSummary(newImported: number): ImportSummary {
  return { total: newImported, newImported, skipped: 0, failed: 0, failedItems: [] }
}

/** 打开导入弹窗（点击侧边栏「同步骑行数据」toggle） */
async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '同步骑行数据' }))
  expect(screen.getByRole('dialog', { name: '同步骑行数据' })).toBeInTheDocument()
}

describe('ImportPanel 关闭刷新', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.mocked(reloadPage).mockClear()
  })

  afterEach(() => {
    useImportStore.setState({
      importing: false,
      progress: { current: 0, total: 0 },
      summary: null,
      errors: [],
      lastFailedFiles: [],
    })
  })

  it('无新导入时关闭弹窗仅收起，不刷新页面', async () => {
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: '关闭' }))

    expect(reloadPage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('有新导入时关闭弹窗整页刷新', async () => {
    useImportStore.setState({ summary: makeSummary(3) })
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: '关闭' }))

    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('全部文件重复（newImported=0）时关闭不刷新', async () => {
    useImportStore.setState({ summary: makeSummary(0) })
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByRole('button', { name: '关闭' }))

    expect(reloadPage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('清除导入结果后关闭仍刷新（新数据已落库）', async () => {
    useImportStore.setState({ summary: makeSummary(2) })
    render(<ImportPanel />)
    await openDialog(user)

    // 用户先点掉结果提示（store.reset），再关闭弹窗——数据已导入，仍需刷新展示
    await user.click(screen.getByRole('button', { name: '清除导入结果' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))

    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭同样在有新导入时刷新', async () => {
    useImportStore.setState({ summary: makeSummary(1) })
    render(<ImportPanel />)
    await openDialog(user)

    await user.keyboard('{Escape}')

    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('导入进行中禁止关闭（关闭按钮禁用，Esc 无效）', async () => {
    useImportStore.setState({ importing: true, summary: makeSummary(1) })
    render(<ImportPanel />)
    await openDialog(user)

    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    await user.keyboard('{Escape}')

    expect(reloadPage).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '同步骑行数据' })).toBeInTheDocument()
  })
})
