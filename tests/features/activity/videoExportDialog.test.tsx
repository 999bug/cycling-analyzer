/**
 * 回放视频导出选项面板测试（方案 B）。
 *
 * 覆盖：默认值、选项回传与本地记忆、取消不触发导出、记忆损坏逐字段回退、录制中禁用交互。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoExportDialog from '@/features/activity/VideoExportDialog'
import {
  DEFAULT_VIDEO_EXPORT_SETTINGS,
  loadVideoExportSettings,
  storeVideoExportSettings,
} from '@/features/activity/videoExportSettings'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

/**
 * 渲染面板并返回回调 spy。
 */
function renderDialog(options?: { exporting?: boolean; progressLabel?: string }) {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  render(
    <VideoExportDialog
      exporting={options?.exporting ?? false}
      progressLabel={options?.progressLabel}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  )
  return { onClose, onConfirm }
}

describe('导出视频选项面板', () => {
  it('默认值：9:16 竖屏 / 30 秒 / 跟随当前底图 / 双字幕都开', () => {
    renderDialog()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '9:16 竖屏' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '30 秒' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '跟随当前' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '开头钩子' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '数据行' })).toBeChecked()
  })

  it('生成时回传所选选项并记忆到本地', async () => {
    const { onConfirm } = renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: '1:1 方形' }))
    await user.click(screen.getByRole('radio', { name: '60 秒' }))
    await user.click(screen.getByRole('radio', { name: '卫星' }))
    await user.click(screen.getByRole('checkbox', { name: '数据行' }))
    await user.click(screen.getByRole('button', { name: '生成' }))

    const expected = {
      aspectRatio: '1:1',
      duration: '60',
      mapMode: 'satellite',
      hook: true,
      dataLine: false,
      hookText: '',
      dataLineText: '',
    }
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(expected)
    expect(loadVideoExportSettings()).toEqual(expected)
  })

  it('勾选字幕时展示可编辑文案输入框，改动随「生成」一并回传', async () => {
    const { onConfirm } = renderDialog()
    const user = userEvent.setup()

    const hookInput = screen.getByLabelText(/钩子文案/)
    await user.clear(hookInput)
    await user.type(hookInput, '今天骑了这条线\n超爽')
    const dataInput = screen.getByLabelText(/数据行文案/)
    await user.clear(dataInput)
    await user.type(dataInput, '自定义数据')

    await user.click(screen.getByRole('button', { name: '生成' }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ hookText: '今天骑了这条线\n超爽', dataLineText: '自定义数据' }),
    )
    expect(loadVideoExportSettings().hookText).toBe('今天骑了这条线\n超爽')
  })

  it('取消勾选字幕时隐藏对应输入框', async () => {
    renderDialog()
    const user = userEvent.setup()

    expect(screen.getByLabelText(/钩子文案/)).toBeInTheDocument()
    expect(screen.getByLabelText(/数据行文案/)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '开头钩子' }))
    await user.click(screen.getByRole('checkbox', { name: '数据行' }))

    expect(screen.queryByLabelText(/钩子文案/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/数据行文案/)).not.toBeInTheDocument()
  })

  it('取消只关闭面板，不触发导出', async () => {
    const { onClose, onConfirm } = renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Esc 关闭面板，不触发导出', async () => {
    const { onClose, onConfirm } = renderDialog()
    const user = userEvent.setup()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('读取上次记忆的选项', () => {
    storeVideoExportSettings({
      aspectRatio: '16:9',
      duration: 'distance',
      mapMode: 'normal',
      hook: false,
      dataLine: true,
      hookText: '',
      dataLineText: '自定义一行',
    })

    renderDialog()

    expect(screen.getByRole('radio', { name: '16:9 横屏' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '跟随里程' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '正常' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '开头钩子' })).not.toBeChecked()
    // 数据行开启且有自定义文案：输入框展示记忆内容
    expect(screen.getByLabelText(/数据行文案/)).toHaveValue('自定义一行')
  })

  it('记忆损坏/字段非法时逐字段回退默认（不整条丢弃）', () => {
    localStorage.setItem(
      'cycling-video-export-settings',
      JSON.stringify({ aspectRatio: '4:3', duration: '60', hook: 'yes' }),
    )

    expect(loadVideoExportSettings()).toEqual({
      ...DEFAULT_VIDEO_EXPORT_SETTINGS,
      duration: '60',
    })

    localStorage.setItem('cycling-video-export-settings', 'not json')
    expect(loadVideoExportSettings()).toEqual(DEFAULT_VIDEO_EXPORT_SETTINGS)
  })

  it('录制中禁用全部交互并展示进度（不可重复触发）', async () => {
    const { onClose, onConfirm } = renderDialog({ exporting: true, progressLabel: '录制中 4/30 秒' })
    const user = userEvent.setup()

    expect(screen.getByRole('status')).toHaveTextContent('录制中 4/30 秒')
    const confirm = screen.getByRole('button', { name: '录制中…' })
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '9:16 竖屏' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '数据行' })).toBeDisabled()

    // 录制中 Esc 不关闭（避免半截文件），点击「生成」也不会二次触发
    await user.keyboard('{Escape}')
    await user.click(confirm)
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
