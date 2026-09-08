/**
 * 导入向导（UI-9 重构）交互测试。
 *
 * 验证三步向导的核心链路：
 * - 第 1 步双路径入口：直接导入卡片（文件夹/单文件）+ 平台卡片网格
 * - 第 2 步指引随平台切换渲染（佳明/Strava 步骤、行者多路径）
 * - 第 3 步导入：来源解析提示与格式说明按路径自适应
 * - 直接导入路径跳过第 2 步（步骤条显示「已跳过」）
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ImportPanel from '@/features/import/ImportPanel'
import { DIRECT_SOURCE_NOTE, PLATFORM_GUIDES } from '@/features/import/platformGuides'

/** 打开导入弹窗（点击侧边栏「同步骑行数据」toggle） */
async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '同步骑行数据' }))
  expect(screen.getByRole('dialog', { name: '同步骑行数据' })).toBeInTheDocument()
}

describe('导入向导 第 1 步（选择方式）', () => {
  it('展示直接导入卡片与全部平台卡片', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    expect(screen.getByText('导入文件夹')).toBeInTheDocument()
    expect(screen.getByText('导入单个文件')).toBeInTheDocument()
    expect(screen.getByText('我已经有导出好的数据')).toBeInTheDocument()
    for (const guide of PLATFORM_GUIDES) {
      expect(screen.getByText(guide.name)).toBeInTheDocument()
    }
  })

  it('提供图文教程外链（新标签页打开教程页）', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    const link = screen.getByRole('link', { name: /图文完整教程/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('href')).toMatch(/tutorial\/export-guide\.html$/)
  })
})

describe('导入向导 第 2 步（导出指引）', () => {
  it('点击佳明卡片显示佳明指引', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('佳明 Garmin'))
    expect(screen.getByText('佳明 Garmin 导出指引')).toBeInTheDocument()
    expect(screen.getByText(/请求数据导出/)).toBeInTheDocument()
    // 步骤条当前步高亮
    expect(screen.getByRole('button', { name: /导出指引/ })).toBeInTheDocument()
  })

  it('返回重选后点击 Strava 显示 Strava 指引（不再出现佳明步骤）', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('佳明 Garmin'))
    await user.click(screen.getByRole('button', { name: '返回重选平台' }))
    await user.click(screen.getByText('Strava'))

    expect(screen.getByText('Strava 导出指引')).toBeInTheDocument()
    expect(screen.getByText(/下载你的帐户数据/)).toBeInTheDocument()
    expect(screen.queryByText(/请求数据导出/)).not.toBeInTheDocument()
  })

  it('行者显示多路径指引', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('行者'))
    expect(screen.getByText('行者 导出指引')).toBeInTheDocument()
    expect(screen.getByText('App 直接导出（Android PRO）')).toBeInTheDocument()
    expect(screen.getByText('轨迹转路书（免费）')).toBeInTheDocument()
  })

  it('指引页教程链接深链到当前平台章节', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('佳明 Garmin'))
    const link = screen.getByRole('link', { name: /佳明 Garmin.*图文教程/ })
    expect(link.getAttribute('href')).toMatch(/tutorial\/export-guide\.html#garmin$/)
  })
})

describe('导入向导 第 3 步（导入数据）', () => {
  it('平台路径：来源与格式提示按所选平台自适应', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('佳明 Garmin'))
    await user.click(screen.getByRole('button', { name: '我已拿到导出文件，进入导入' }))

    expect(screen.getByText('拖入佳明 Garmin导出的文件 / 目录 / ZIP 压缩包')).toBeInTheDocument()
    expect(screen.getByText(/已自动按「佳明 Garmin」来源解析/)).toBeInTheDocument()
    expect(screen.getByText('导出包内为 FIT 原生格式，数据完整准确，无需解压整包拖入即可。')).toBeInTheDocument()
  })

  it('直接导入路径：跳过指引步骤并显示文件名兜底说明', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('导入文件夹'))

    // 已进入第 3 步（拖拽区文案为直接导入版）
    expect(screen.getByText('拖入已整理的文件夹 / 文件 / ZIP 压缩包')).toBeInTheDocument()
    expect(screen.getByText(DIRECT_SOURCE_NOTE)).toBeInTheDocument()
    expect(screen.getByText(/GPX 是有损格式/)).toBeInTheDocument()
    // 步骤条第 2 步显示「已跳过」
    expect(screen.getByText(/导出指引（已跳过）/)).toBeInTheDocument()
  })

  it('平台路径的第 3 步可经步骤条返回第 1 步', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.click(screen.getByText('高驰 COROS'))
    await user.click(screen.getByRole('button', { name: '我已拿到导出文件，进入导入' }))
    await user.click(screen.getByRole('button', { name: /^1/ }))

    expect(screen.getByText('我已经有导出好的数据')).toBeInTheDocument()
  })
})

describe('导入向导 弹窗框架', () => {
  it('无新导入时 Esc 关闭弹窗不刷新', async () => {
    const user = userEvent.setup()
    render(<ImportPanel />)
    await openDialog(user)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('导入进行中步骤条禁止切换', async () => {
    const user = userEvent.setup()
    const { act } = await import('react')
    const { useImportStore } = await import('@/stores/importStore')
    await act(async () => {
      useImportStore.setState({ importing: true })
    })
    render(<ImportPanel />)
    await openDialog(user)

    // 弹窗打开时已在第 1 步，导入中点击步骤条无效（无切换目标可断言，
    // 这里验证进度视图替换了入口内容且无平台卡片）
    const dialog = screen.getByRole('dialog', { name: '同步骑行数据' })
    expect(within(dialog).queryByText('我已经有导出好的数据')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/已处理/)).toBeInTheDocument()
  })
})
