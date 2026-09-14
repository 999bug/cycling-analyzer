/**
 * 设置页「AI 服务」区块测试（AiSettingsSection，v2 供应商管理）。
 * 契约：添加流程（选模板 → 贴 Key → 保存入列表，首个自动启用）；
 * 启用切换 / 编辑 / 删除；自定义模板要求地址；「获取模型列表」填充下拉；
 * 「更多供应商」搜索面板按名称/域名过滤。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiSettingsSection from '@/features/ai/AiSettingsSection'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ profiles: [], activeProfileId: null })
  vi.restoreAllMocks()
})

/** 打开编辑器并选 DeepSeek 模板 */
function openDeepSeekEditor() {
  render(<AiSettingsSection id="ai-service" />)
  fireEvent.click(screen.getByRole('button', { name: '＋ 添加供应商' }))
  fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }))
}

describe('AiSettingsSection（列表）', () => {
  it('初始无配置：空态提示 + 添加按钮', () => {
    render(<AiSettingsSection id="ai-service" />)
    expect(screen.getByText(/还没有配置/)).toBeDefined()
    expect(screen.getByRole('button', { name: '＋ 添加供应商' })).toBeDefined()
    expect(screen.getByText('未配置')).toBeDefined()
  })

  it('启用按钮切换生效配置', () => {
    const first = useAiConfigStore.getState().addProfile({
      name: '第一套',
      vendorId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-123456',
      model: 'deepseek-chat',
    })
    const firstProfile = useAiConfigStore.getState().profiles.find((p) => p.id === first)!
    const second = useAiConfigStore.getState().addProfile({ ...firstProfile, name: '第二套' })

    render(<AiSettingsSection id="ai-service" />)
    expect(screen.getByText(/当前生效：第一套/)).toBeDefined()

    const enableButtons = screen.getAllByRole('button', { name: '启用' })
    expect(enableButtons).toHaveLength(1)
    fireEvent.click(enableButtons[0])
    expect(useAiConfigStore.getState().activeProfileId).toBe(second)
    expect(screen.getByText(/当前生效：第二套/)).toBeDefined()
  })

  it('删除需确认；确认后从列表移除', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = useAiConfigStore.getState()
    store.addProfile({
      name: '要删的',
      vendorId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-123456',
      model: 'deepseek-chat',
    })

    render(<AiSettingsSection id="ai-service" />)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(useAiConfigStore.getState().profiles).toHaveLength(0)
  })
})

describe('AiSettingsSection（添加 / 编辑表单）', () => {
  it('选模板 → 贴 Key → 保存：首个配置自动启用', () => {
    openDeepSeekEditor()
    const keyInput = screen.getByLabelText('API Key') as HTMLInputElement
    expect(keyInput.type).toBe('password')

    const baseUrlInput = screen.getByLabelText('接口地址') as HTMLInputElement
    expect(baseUrlInput.value).toBe('https://api.deepseek.com/v1')
    expect(baseUrlInput.disabled).toBe(true)

    const modelInput = screen.getByLabelText('模型') as HTMLInputElement
    expect(modelInput.value).toBe('deepseek-chat')

    fireEvent.change(keyInput, { target: { value: 'sk-test-123456' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const state = useAiConfigStore.getState()
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].vendorId).toBe('deepseek')
    expect(state.activeProfileId).toBe(state.profiles[0].id)
    // 编辑器关闭、状态行更新
    expect(screen.getByText(/当前生效：DeepSeek（DeepSeek \/ deepseek-chat）/)).toBeDefined()
  })

  it('自定义模板：地址自动补 /v1 后保存', () => {
    render(<AiSettingsSection id="ai-service" />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加供应商' }))
    fireEvent.click(screen.getByRole('button', { name: /自定义 \/ 中转/ }))

    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: 'https://relay.example.com/api' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-123456' } })
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'some-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(useAiConfigStore.getState().profiles[0].baseUrl).toBe('https://relay.example.com/api/v1')
  })

  it('编辑现有配置：改模型后保存只更新该配置', () => {
    const store = useAiConfigStore.getState()
    const id = store.addProfile({
      name: 'OpenRouter 免费档',
      vendorId: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test-123456',
      model: 'inclusionai/ling-3.0-flash-vl:free',
    })

    render(<AiSettingsSection id="ai-service" />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    // 编辑模式 Key 预填已有值
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('sk-or-test-123456')

    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek/deepseek-chat-v3.1:free' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const profile = useAiConfigStore.getState().profiles.find((p) => p.id === id)
    expect(profile?.model).toBe('deepseek/deepseek-chat-v3.1:free')
    expect(useAiConfigStore.getState().profiles).toHaveLength(1)
  })

  it('获取模型列表：GET /models 结果填充 datalist', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/models')
        ? ({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'free-model:free' }, { id: 'paid-model' }] }),
          }) as unknown as Response
        : ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: '正常' } }] }),
          }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    openDeepSeekEditor()
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-123456' } })
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }))

    await waitFor(() => expect(screen.getByText(/已获取 2 个模型/)).toBeDefined())
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/models'))).toBe(true)

    vi.unstubAllGlobals()
  })

  it('「更多供应商」搜索面板：按名称过滤并可选模板', () => {
    openDeepSeekEditor()
    fireEvent.click(screen.getByRole('button', { name: /更多供应商（59）/ }))

    const search = screen.getByPlaceholderText(/搜索名称或域名/)
    fireEvent.change(search, { target: { value: '硅基' } })
    expect(screen.getByText('硅基流动 SiliconFlow')).toBeDefined()
    expect(screen.queryByText('PackyCode')).toBeNull()

    fireEvent.click(screen.getByText('硅基流动 SiliconFlow'))
    expect((screen.getByLabelText('接口地址') as HTMLInputElement).value).toBe(
      'https://api.siliconflow.cn/v1',
    )
  })
})
