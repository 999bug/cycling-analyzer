/**
 * 分享素材弹窗测试（ShareStudioModal）。
 * jsdom 无 2d canvas：组件走「画布不可用」降级分支，断言不崩溃 + 控件齐全；
 * 文案编辑/恢复默认/平台切换/Esc 关闭为纯 UI 逻辑，可完整断言。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ShareStudioModal from '@/features/share/ShareStudioModal'
import type { Activity } from '@/types/activity'

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    startTime: '2026-09-06T07:30:00+08:00',
    endTime: '2026-09-06T12:00:00+08:00',
    duration: 4 * 3600 + 12 * 60,
    elapsedTime: 4.5 * 3600,
    distance: 108_400,
    elevationGain: 1268,
    avgSpeed: 25.8 / 3.6,
    name: '周末长距离',
    ...overrides,
  }
}

function renderModal(overrides: Partial<Activity> = {}) {
  return render(<ShareStudioModal activity={makeActivity(overrides)} records={[]} distanceUnit="km" onClose={() => {}} />)
}

describe('ShareStudioModal 分享弹窗', () => {
  it('渲染弹窗骨架：平台选项、文案区、隐私说明与下载按钮', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: '分享素材创作' })).toBeDefined()
    expect(screen.getByRole('button', { name: /朋友圈/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /小红书/ })).toBeDefined()
    expect(screen.getByText('文案不进图，发布时粘贴使用')).toBeDefined()
    expect(screen.getByText('图片在本浏览器内绘制，不会上传到任何服务器')).toBeDefined()
    expect(screen.getByRole('button', { name: '下载图片' })).toBeDefined()
  })

  it('默认朋友圈文案由真实数据生成', () => {
    renderModal()

    const textarea = screen.getByLabelText('朋友圈文案') as HTMLTextAreaElement
    expect(textarea.value).toContain('骑了 108.4 公里')
    expect(textarea.value).toContain('爬升 1268 米')
  })

  it('文案可编辑，恢复默认回到模板值', () => {
    renderModal()

    const textarea = screen.getByLabelText('朋友圈文案') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '自定义文案' } })
    expect(textarea.value).toBe('自定义文案')

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect((screen.getByLabelText('朋友圈文案') as HTMLTextAreaElement).value).toContain('骑了 108.4')
  })

  it('切到小红书：出现标题输入框与 4 页分页器，正文可编辑', () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: /小红书/ }))

    const title = screen.getByLabelText('小红书标题') as HTMLInputElement
    expect(title.value.length).toBeLessThanOrEqual(20)
    expect(title.value).toContain('108.4')
    expect(screen.getByText('1/4 · 封面')).toBeDefined()
    expect(screen.getByRole('button', { name: '下载全部 4 张' })).toBeDefined()

    fireEvent.change(screen.getByLabelText('小红书正文'), { target: { value: '我的正文' } })
    expect((screen.getByLabelText('小红书正文') as HTMLInputElement).value).toBe('我的正文')
  })

  it('小红书分页器翻页：页码与标签联动且不越界', () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: /小红书/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('2/4 · 路线')).toBeDefined()

    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement
    for (let index = 0; index < 10 && !next.disabled; index += 1) {
      fireEvent.click(next)
    }
    expect(screen.getByText('4/4 · 图表')).toBeDefined()
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Esc 与关闭按钮触发 onClose；遮罩点击关闭、面板内点击不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ShareStudioModal activity={makeActivity()} records={[]} distanceUnit="km" onClose={onClose} />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(container.querySelector('.share-studio__overlay') as Element)
    expect(onClose).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('dialog', { name: '分享素材创作' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
