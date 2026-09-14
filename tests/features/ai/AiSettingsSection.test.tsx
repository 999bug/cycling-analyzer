/**
 * 设置页「AI 服务」区块测试（AiSettingsSection）。
 * 契约：选厂商 → 贴 Key → 保存进 store（localStorage 独立键）；
 * 自定义厂商要求地址与模型名；清空配置后状态回到未配置。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AiSettingsSection from '@/features/ai/AiSettingsSection'
import { useAiConfigStore } from '@/features/ai/aiConfigStore'

beforeEach(() => {
  window.localStorage.clear()
  useAiConfigStore.setState({ providerId: null, apiKey: '', model: '', customBaseUrl: '' })
})

describe('AiSettingsSection', () => {
  it('初始未选厂商：只有厂商卡片，保存不可用', () => {
    render(<AiSettingsSection id="ai-service" />)
    expect(screen.getByRole('button', { name: /DeepSeek/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /通义千问/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /OpenRouter/ })).toBeDefined()
    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('选预设厂商后只填 Key 即可保存（模型预选默认推荐）', () => {
    render(<AiSettingsSection id="ai-service" />)
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }))

    const keyInput = screen.getByLabelText('API Key') as HTMLInputElement
    expect(keyInput.type).toBe('password')
    const modelSelect = screen.getByLabelText('模型') as HTMLSelectElement
    expect(modelSelect.value).toBe('deepseek-chat')

    // Key 太短仍不可保存
    fireEvent.change(keyInput, { target: { value: 'sk' } })
    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(keyInput, { target: { value: 'sk-test-123456' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    expect(useAiConfigStore.getState().providerId).toBe('deepseek')
    expect(useAiConfigStore.getState().apiKey).toBe('sk-test-123456')
    expect(screen.getByText(/已保存（仅存本机浏览器）/)).toBeDefined()
    expect(screen.getByText(/已配置 · DeepSeek \/ deepseek-chat/)).toBeDefined()
  })

  it('自定义厂商：缺接口地址不可保存，填齐后通过', () => {
    render(<AiSettingsSection id="ai-service" />)
    fireEvent.click(screen.getByRole('button', { name: /自定义/ }))

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-123456' } })
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://relay.example.com/v1' },
    })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'qwen-max' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    expect(useAiConfigStore.getState().providerId).toBe('custom')
    expect(useAiConfigStore.getState().customBaseUrl).toBe('https://relay.example.com/v1')
  })

  it('清空配置回到未配置且入口提示随之更新', () => {
    useAiConfigStore.setState({
      providerId: 'deepseek',
      apiKey: 'sk-test-123456',
      model: 'deepseek-chat',
      customBaseUrl: '',
    })
    render(<AiSettingsSection id="ai-service" />)
    expect(screen.getByText(/已配置 · DeepSeek \/ deepseek-chat/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '清空配置' }))
    expect(useAiConfigStore.getState().providerId).toBeNull()
    expect(useAiConfigStore.getState().apiKey).toBe('')
    expect(screen.getByText('未配置')).toBeDefined()
  })
})
