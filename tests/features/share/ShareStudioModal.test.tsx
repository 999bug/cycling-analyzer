/**
 * 分享素材弹窗测试（ShareStudioModal）。
 * jsdom 无 2d canvas：Canvas 链路走「画布不可用」降级分支，断言不崩溃 + 控件齐全；
 * 文案编辑/恢复默认/平台切换/Esc 关闭为纯 UI 逻辑，可完整断言。
 *
 * 真实界面链路（v2 一期）的出图由 shareStageCapture 承担，这里把它整体 mock：
 * 只验证弹窗的编排——默认样式、图上文字与预览同步、出图成功/降级两条分支。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareStudioModal from '@/features/share/ShareStudioModal'
import { captureShareStagePng, downloadShareStagePng } from '@/features/share/shareStageCapture'
import { downloadSharePng } from '@/features/share/shareCanvas'
import type { Activity } from '@/types/activity'

vi.mock('@/features/share/shareStageCapture', () => ({
  SHARE_STAGE_WIDTH: 1080,
  SHARE_STAGE_HEIGHT: 1440,
  waitForStageTiles: vi.fn(async () => {}),
  captureShareStagePng: vi.fn(),
  downloadShareStagePng: vi.fn(),
  shareStageFileName: vi.fn(() => '骑了么-2026-09-06-真实界面.png'),
}))

// 只替换下载动作：绘制与分页等真实实现保留（极简手绘链路的断言依赖它们）
vi.mock('@/features/share/shareCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/share/shareCanvas')>()
  return { ...actual, downloadSharePng: vi.fn(() => true) }
})

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    fileId: 'file-1',
    fileName: 'sample.fit',
    fingerprint: 'fp-1',
    activityType: 'cycling',
    // 不带时区偏移 → 按本地时间解析，任何时区下都落在同一天（CI 跑 UTC，
    // 用 +08:00 的绝对时间会让同一次骑行在 UTC 下落到前一天，文件名断言随之失败）
    startTime: '2026-09-06T12:00:00',
    endTime: '2026-09-06T16:30:00',
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

// 每个用例干净起步：出图/下载是跨用例累计的 spy，残留调用会让「调用次数」断言失准
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(captureShareStagePng).mockReset()
})

describe('ShareStudioModal 分享弹窗', () => {
  it('渲染弹窗骨架：平台选项、文案区、隐私说明与下载按钮', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: '分享素材创作' })).toBeDefined()
    expect(screen.getByRole('button', { name: /朋友圈/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /小红书/ })).toBeDefined()
    expect(screen.getByText('文案不进图，发布时粘贴使用')).toBeDefined()
    // 隐私承诺：默认真实界面样式直说底图来源（有底图就有瓦片请求，不能沿用「无网络请求」口径）
    expect(
      screen.getByText('图片在本机合成；底图瓦片来自地图服务，骑行数据不会上传'),
    ).toBeDefined()
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

    fireEvent.click(screen.getByRole('button', { name: '恢复默认文案' }))
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

describe('ShareStudioModal 真实界面样式（v2 一期）', () => {
  it('默认样式为真实界面：出图说明 + 图上文字区，且隐私说明改为底图口径', () => {
    renderModal()

    expect(screen.getByRole('group', { name: '卡片样式' })).toBeDefined()
    expect(screen.getByRole('button', { name: /真实界面/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('成图 1080×1440 的 2 倍图 · 底图为真实地图')).toBeDefined()
    expect(screen.getByLabelText('图上标题')).toBeDefined()
    expect(screen.getByLabelText('图上文案')).toBeDefined()
    expect(screen.getByText(/底图瓦片来自地图服务/)).toBeDefined()
  })

  it('图上标题/文案默认取真实数据，可编辑并同步到预览', () => {
    const { container } = renderModal()

    const title = screen.getByLabelText('图上标题') as HTMLInputElement
    const script = screen.getByLabelText('图上文案') as HTMLTextAreaElement
    expect(title.value).toBe('周末长距离')
    expect(script.value).toContain('骑了 108.4 公里')

    fireEvent.change(title, { target: { value: '自定义标题' } })
    fireEvent.change(script, { target: { value: '今天风很大' } })

    // 预览就是成片：舞台上出现编辑后的文字
    expect(container.querySelector('.share-stage__title')?.textContent).toBe('自定义标题')
    expect(container.querySelector('.share-stage__script')?.textContent).toBe('今天风很大')

    // 恢复默认回到真实数据
    fireEvent.click(screen.getByRole('button', { name: '恢复默认文字' }))
    expect((screen.getByLabelText('图上标题') as HTMLInputElement).value).toBe('周末长距离')
    expect((screen.getByLabelText('图上文案') as HTMLTextAreaElement).value).toContain('108.4')
  })

  it('切到极简手绘：图上文字区收起，canvas 不可用时给出降级提示', () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: /极简手绘/ }))

    expect(screen.queryByLabelText('图上标题')).toBeNull()
    expect(screen.getByText('当前环境不支持画布预览，下载功能不可用')).toBeDefined()
    expect(screen.getByText('图片在本浏览器内绘制，不会上传到任何服务器')).toBeDefined()
  })

  it('下载成功：走真实界面快照链路，不落降级提示', async () => {
    vi.mocked(captureShareStagePng).mockResolvedValueOnce(new Blob(['png']))
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: '下载图片' }))

    await waitFor(() => expect(downloadShareStagePng).toHaveBeenCalledTimes(1))
    expect(downloadSharePng).not.toHaveBeenCalled()
    expect(screen.queryByText(/已改用极简手绘导出/)).toBeNull()
  })

  it('快照不可用：自动降级为极简手绘并提示用户', async () => {
    vi.mocked(captureShareStagePng).mockResolvedValueOnce(undefined)
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: '下载图片' }))

    await waitFor(() =>
      expect(screen.getByText('真实界面出图不可用，已改用极简手绘导出')).toBeDefined(),
    )
    expect(downloadSharePng).toHaveBeenCalledWith(expect.anything(), 'moments', 0, '2026-09-06')
  })

  it('切到小红书：真实界面挂出 4 页套图，分页器与「下载全部」就位', () => {
    const { container } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: /小红书/ }))

    // 四页常驻挂载（非当前页移出视口，出图按节点取），当前页是封面
    const pages = Array.from(container.querySelectorAll('.share-studio__stage-page'))
    expect(pages.map((node) => node.getAttribute('data-active'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    expect(container.querySelectorAll('[data-page="cover"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-page="charts"]')).toHaveLength(1)
    expect(screen.getByText('1/4 · 封面')).toBeDefined()
    expect(screen.getByText('第 1/4 页 · 共 4 页套图，成图 1080×1440 的 2 倍图')).toBeDefined()
    // 小红书没有「图上标题」输入（封面大字来自真实数据），图上文案仍在
    expect(screen.queryByLabelText('图上标题')).toBeNull()
    expect(screen.getByLabelText('图上文案')).toBeDefined()
    expect(screen.getByRole('button', { name: '下载全部 4 张' })).toBeDefined()
  })

  it('小红书翻页切换预览页，且四页都能各自出图', async () => {
    vi.mocked(captureShareStagePng).mockResolvedValue(new Blob(['png']))
    const { container } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: /小红书/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByText('2/4 · 路线')).toBeDefined()
    expect(
      Array.from(container.querySelectorAll('.share-studio__stage-page')).map((node) =>
        node.getAttribute('data-active'),
      ),
    ).toEqual(['false', 'true', 'false', 'false'])

    fireEvent.click(screen.getByRole('button', { name: '下载全部 4 张' }))

    // 逐页出图：4 次快照 + 4 次下载，文件名带页标签（封面/路线/洞察/图表）
    await waitFor(() => expect(downloadShareStagePng).toHaveBeenCalledTimes(4))
    expect(vi.mocked(captureShareStagePng).mock.calls.map((call) => call[0])).toHaveLength(4)
    expect(vi.mocked(downloadShareStagePng).mock.calls.map((call) => call[2])).toEqual([
      '封面',
      '路线',
      '洞察',
      '图表',
    ])
  })
})
