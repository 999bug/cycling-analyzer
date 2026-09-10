/**
 * 录制前引导层测试。
 *
 * 覆盖：环境支持时主按钮可用；不支持时禁用并提示；点「开始录制」/「不用授权」分别派发；
 * 录制中只展示进度、不响应操作；点遮罩/关闭触发取消。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import VideoExportGuide from '@/features/activity/VideoExportGuide'

/** 渲染引导层并返回回调 spy */
function renderGuide(options?: { canCapture?: boolean; exporting?: boolean; progressLabel?: string }) {
  const onClose = vi.fn()
  const onRecord = vi.fn()
  const onBuiltin = vi.fn()
  render(
    <VideoExportGuide
      canCapture={options?.canCapture ?? true}
      exporting={options?.exporting ?? false}
      progressLabel={options?.progressLabel}
      onClose={onClose}
      onRecord={onRecord}
      onBuiltin={onBuiltin}
    />,
  )
  return { onClose, onRecord, onBuiltin }
}

describe('录制前引导层', () => {
  it('展示说明步骤与两个明确选择', () => {
    renderGuide()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始录制' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不用授权，改用内置绘制' })).toBeInTheDocument()
    expect(screen.getByText(/浏览器顶部会弹出授权窗口/)).toBeInTheDocument()
  })

  it('点「开始录制」派发 onRecord，「不用授权」派发 onBuiltin', async () => {
    const { onRecord, onBuiltin } = renderGuide()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '开始录制' }))
    expect(onRecord).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '不用授权，改用内置绘制' }))
    expect(onBuiltin).toHaveBeenCalledTimes(1)
  })

  it('环境不支持屏幕共享时禁用主按钮并提示改用内置', () => {
    renderGuide({ canCapture: false })

    expect(screen.getByRole('button', { name: '开始录制' })).toBeDisabled()
    expect(screen.getByText(/当前浏览器不支持屏幕共享/)).toBeInTheDocument()
  })

  it('录制中只展示进度，不响应操作', async () => {
    const { onRecord, onBuiltin, onClose } = renderGuide({
      exporting: true,
      progressLabel: '录制中 4/30 秒',
    })
    const user = userEvent.setup()

    expect(screen.getByRole('status')).toHaveTextContent('录制中 4/30 秒')
    expect(screen.queryByRole('button', { name: '开始录制' })).not.toBeInTheDocument()
    // 点遮罩不关闭（录制中）
    await user.click(screen.getByTestId('video-export-guide'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onRecord).not.toHaveBeenCalled()
    expect(onBuiltin).not.toHaveBeenCalled()
  })

  it('点关闭派发取消', async () => {
    const { onClose } = renderGuide()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
