/**
 * 设置页「AI 服务」区块（AI 接入 v1，BYOK：用户自填 Key，浏览器直连服务商）。
 *
 * 配置流程压缩到两步（原型评审定稿）：选厂商 → 贴 Key；接口地址与模型
 * 参数全部由预设表内置，「高级选项」里可看不可改（自定义厂商除外）。
 * 保存进 localStorage 独立 store（aiConfigStore），不进 Dexie settings 表，
 * 因此不会随「导出数据」的 JSON 备份带出。
 */
import { useState, type ChangeEvent } from 'react'
import { AI_PROVIDERS, getAiProvider, type AiProviderId } from '@/features/ai/providers'
import { resolveAiConfig, useAiConfigStore } from '@/features/ai/aiConfigStore'
import { testAiConnection } from '@/features/ai/aiClient'
import '@/features/ai/ai.css'

/** 连接测试状态 */
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

/** Key 最短长度（低于此视为没贴全，测试前拦截） */
const MIN_API_KEY_LENGTH = 8

/**
 * AI 服务区块组件。
 *
 * @param props 组件参数（id 供设置页目录锚点）
 */
function AiSettingsSection({ id }: { id?: string }) {
  const saved = useAiConfigStore()
  const [selectedId, setSelectedId] = useState<AiProviderId | null>(saved.providerId)
  const [apiKeyDraft, setApiKeyDraft] = useState(saved.apiKey)
  const [modelDraft, setModelDraft] = useState(saved.model)
  const [baseUrlDraft, setBaseUrlDraft] = useState(saved.customBaseUrl)
  const [keyVisible, setKeyVisible] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined)
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const preset = getAiProvider(selectedId)

  /** 当前草稿能否保存（自定义厂商要求地址与模型名齐全） */
  const canSave =
    preset !== undefined &&
    apiKeyDraft.trim().length >= MIN_API_KEY_LENGTH &&
    (preset.id !== 'custom' ||
      (baseUrlDraft.trim().length > 0 && modelDraft.trim().length > 0))

  /** 保存后的生效配置（状态行展示用） */
  const activeConfig = resolveAiConfig(saved)

  /**
   * 选中厂商：模型重置为该厂商默认（Key 保留，方便对比试各家）。
   *
   * @param next 目标厂商 id
   */
  function handleSelectProvider(next: AiProviderId) {
    setSelectedId(next)
    setTestStatus('idle')
    setTestMessage('')
    setSaveMessage(null)
    const nextPreset = getAiProvider(next)
    setModelDraft(nextPreset?.defaultModel ?? '')
  }

  /** 保存配置到本机 store */
  function handleSave() {
    if (selectedId === null || !canSave) {
      return
    }
    saved.saveConfig({
      providerId: selectedId,
      apiKey: apiKeyDraft.trim(),
      model: modelDraft.trim(),
      customBaseUrl: baseUrlDraft.trim(),
    })
    setSaveMessage({ ok: true, text: 'AI 设置已保存（仅存本机浏览器）。分享文案与骑行解读的 AI 按钮已可用。' })
  }

  /** 清空配置（删除 Key；各 AI 入口随之隐藏） */
  function handleClear() {
    saved.clearConfig()
    setSelectedId(null)
    setApiKeyDraft('')
    setModelDraft('')
    setBaseUrlDraft('')
    setTestStatus('idle')
    setTestMessage('')
    setSaveMessage({ ok: true, text: '已清空 AI 配置，相关入口已隐藏' })
  }

  /** 连接测试：用草稿配置发一条极小请求（不落库也能测） */
  async function handleTest() {
    if (preset === undefined) {
      return
    }
    const draft = resolveAiConfig({
      providerId: selectedId,
      apiKey: apiKeyDraft,
      model: modelDraft,
      customBaseUrl: baseUrlDraft,
    })
    if (draft === null) {
      setTestStatus('fail')
      setTestMessage('配置不完整：请先贴 Key' + (preset.id === 'custom' ? '，并填好接口地址与模型名' : ''))
      return
    }
    setTestStatus('testing')
    setTestMessage('')
    try {
      const latency = await testAiConnection(draft)
      setTestLatency(latency)
      setTestStatus('ok')
    } catch (error) {
      setTestStatus('fail')
      setTestMessage(error instanceof Error ? error.message : '连接失败，请重试')
    }
  }

  /** Key 输入（变化即重置测试与保存提示，避免提示对不上当前内容） */
  function handleKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setApiKeyDraft(event.target.value)
    setTestStatus('idle')
    setSaveMessage(null)
  }

  return (
    <section className="settings-section" aria-label="AI 服务" id={id}>
      <h2 className="settings-section__title">AI 服务</h2>
      <p className="settings-section__hint">
        用于分享文案与骑行解读的 AI 生成。预设厂商已内置接口地址与模型参数，你只需要粘贴 Key；
        Key 只保存在本机浏览器，不会随数据导出，更不会上传到本站。
      </p>

      <div className="ai-service__providers" role="group" aria-label="选择服务商">
        {AI_PROVIDERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === selectedId
                ? 'ai-service__provider ai-service__provider--active'
                : 'ai-service__provider'
            }
            aria-pressed={item.id === selectedId}
            onClick={() => handleSelectProvider(item.id)}
          >
            <span className="ai-service__provider-name">
              {item.name}
              {item.tag.length > 0 && <span className="ai-service__provider-tag">{item.tag}</span>}
            </span>
            <span className="ai-service__provider-desc">{item.desc}</span>
          </button>
        ))}
      </div>

      {preset !== undefined && (
        <div className="settings-fields" style={{ marginTop: 14 }}>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="ai-service-key">
              API Key
            </label>
            <span className="ai-service__key-wrap">
              <input
                id="ai-service-key"
                type={keyVisible ? 'text' : 'password'}
                className="settings-field__input"
                placeholder="粘贴服务商控制台里的密钥，仅存本机"
                autoComplete="off"
                value={apiKeyDraft}
                onChange={handleKeyChange}
              />
              <button
                type="button"
                className="settings-button"
                onClick={() => setKeyVisible((current) => !current)}
              >
                {keyVisible ? '隐藏' : '显示'}
              </button>
            </span>
          </div>

          {preset.id === 'custom' ? (
            <>
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="ai-service-base-url">
                  接口地址
                </label>
                <input
                  id="ai-service-base-url"
                  type="text"
                  className="settings-field__input"
                  placeholder="以 /v1 结尾的 OpenAI 兼容地址"
                  value={baseUrlDraft}
                  onChange={(event) => {
                    setBaseUrlDraft(event.target.value)
                    setTestStatus('idle')
                    setSaveMessage(null)
                  }}
                />
              </div>
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="ai-service-model">
                  模型名称
                </label>
                <input
                  id="ai-service-model"
                  type="text"
                  className="settings-field__input"
                  placeholder="服务商提供的模型 ID，如 qwen-max"
                  value={modelDraft}
                  onChange={(event) => {
                    setModelDraft(event.target.value)
                    setTestStatus('idle')
                    setSaveMessage(null)
                  }}
                />
              </div>
            </>
          ) : (
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="ai-service-model">
                模型
              </label>
              <select
                id="ai-service-model"
                className="settings-field__select"
                value={modelDraft}
                onChange={(event) => {
                  setModelDraft(event.target.value)
                  setTestStatus('idle')
                  setSaveMessage(null)
                }}
              >
                {(preset.models ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="ai-service__prefill-note">接口地址已预填：{preset.baseUrl}</span>
            </div>
          )}

          <div className="settings-field">
            <span className="settings-field__label">连接测试</span>
            <button
              type="button"
              className="settings-button"
              onClick={() => void handleTest()}
              disabled={testStatus === 'testing' || apiKeyDraft.trim().length === 0}
            >
              {testStatus === 'testing' ? '测试中…' : '测试连接'}
            </button>
            <span className="ai-service__hint">发送一条极小请求验证 Key 可用</span>
          </div>
        </div>
      )}

      {testMessage.length > 0 && (
        <p
          role="status"
          className={
            testStatus === 'ok'
              ? 'settings-message settings-message--success'
              : 'settings-message settings-message--error'
          }
        >
          {testStatus === 'ok'
            ? `连接成功 · ${modelDraft || '默认模型'} 可用 · 延迟 ${testLatency ?? 0} ms`
            : testMessage}
        </p>
      )}

      {saveMessage !== null && (
        <p
          role="status"
          className={
            saveMessage.ok
              ? 'settings-message settings-message--success'
              : 'settings-message settings-message--error'
          }
        >
          {saveMessage.text}
        </p>
      )}

      <div className="settings-form__actions" style={{ marginTop: 12 }}>
        {activeConfig !== null && (
          <button type="button" className="settings-button settings-button--danger" onClick={handleClear}>
            清空配置
          </button>
        )}
        <button
          type="button"
          className="settings-button settings-button--primary"
          onClick={handleSave}
          disabled={!canSave}
        >
          保存配置
        </button>
      </div>

      <div className="ai-service__status">
        <span>
          <span className={activeConfig !== null ? 'ai-service__dot ai-service__dot--on' : 'ai-service__dot'} />
          {activeConfig !== null
            ? `已配置 · ${getAiProvider(activeConfig.providerId)?.name ?? ''} / ${activeConfig.model}`
            : '未配置'}
        </span>
        <span>
          数据上行：<strong>仅聚合指标</strong>（距离 / 爬升 / 功率等汇总数字）
        </span>
      </div>
      <p className="ai-service__privacy">
        隐私边界：AI 只接收聚合指标，GPS 轨迹点与逐点心率不出本机；所有 AI 功能默认关闭，
        配置 Key 后按需使用；生成结果按活动缓存，不重复计费。
      </p>
    </section>
  )
}

export default AiSettingsSection
