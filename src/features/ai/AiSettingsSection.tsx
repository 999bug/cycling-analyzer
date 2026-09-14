/**
 * 设置页「AI 服务」区块（AI 接入 v2：cc-switch 式供应商管理）。
 *
 * 结构：
 * - 配置列表：每套供应商配置一行（名称 / 厂商 / 地址 / 模型 / Key 掩码），
 *   当前生效配置高亮挂「使用中」徽章；行内操作：启用 / 编辑 / 删除。
 * - 添加 / 编辑表单（ProfileEditor）：8 张常用模板卡置顶 +「更多供应商」
 *   搜索面板（60 条预设库，按分类与名称/域名过滤）；「获取模型列表」
 *   调 GET /models 填充模型下拉；连接测试以 HTTP 200 为准。
 *
 * Key 安全：全部配置只存本机 localStorage（aiConfigStore），不进 Dexie
 * settings 表（不随 JSON 备份导出）；列表只显示掩码。
 */
import { useMemo, useState, type ChangeEvent } from 'react'
import {
  clearAiDebugLog,
  listAiDebugLog,
  type AiDebugEntry,
} from '@/features/ai/aiDebugLog'
import {
  AI_COMMON_TEMPLATES,
  AI_PRESET_LIBRARY,
  AI_VENDOR_CATEGORY_LABELS,
  CUSTOM_VENDOR_ID,
  getAiVendor,
  type AiVendorCategory,
  type AiVendorPreset,
} from '@/features/ai/providers'
import {
  clampMaxOutputTokens,
  normalizeAiBaseUrl,
  useAiConfigStore,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type AiProfile,
} from '@/features/ai/aiConfigStore'
import { fetchAiModelList, testAiConnection } from '@/features/ai/aiClient'
import '@/features/ai/ai.css'

/** 连接测试状态 */
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

/** 拉取模型列表状态 */
type FetchStatus = 'idle' | 'fetching' | 'ok' | 'fail'

/** Key 最短长度（低于此视为没贴全，测试前拦截） */
const MIN_API_KEY_LENGTH = 8

/** Key 掩码：保留前 5 后 4（过短整段打码） */
function maskKey(key: string): string {
  if (key.length <= 12) {
    return '****'
  }
  return `${key.slice(0, 5)}****${key.slice(-4)}`
}

/**
 * AI 服务区块组件。
 *
 * @param props 组件参数（id 供设置页目录锚点）
 */
function AiSettingsSection({ id }: { id?: string }) {
  const profiles = useAiConfigStore((state) => state.profiles)
  const activeProfileId = useAiConfigStore((state) => state.activeProfileId)
  const setActiveProfile = useAiConfigStore((state) => state.setActiveProfile)
  const removeProfile = useAiConfigStore((state) => state.removeProfile)
  const maxOutputTokens = useAiConfigStore((state) => state.maxOutputTokens)
  const setMaxOutputTokens = useAiConfigStore((state) => state.setMaxOutputTokens)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  /** 输出上限输入草稿（提交时 clamp 并持久化） */
  const [limitDraft, setLimitDraft] = useState(String(maxOutputTokens))

  // 诊断日志（展开面板时刷新；初始空态即可，规则禁 effect 同步 setState）
  const [debugEntries, setDebugEntries] = useState<AiDebugEntry[]>([])
  const [debugErrorsOnly, setDebugErrorsOnly] = useState(false)
  const [debugNotice, setDebugNotice] = useState<string | null>(null)
  const debugView = useMemo(
    () =>
      (debugErrorsOnly
        ? debugEntries.filter((entry) => entry.status === 'error')
        : debugEntries
      ).slice()
        .reverse(),
    [debugEntries, debugErrorsOnly],
  )

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)

  /**
   * 保存输出上限（clamp 后写入 store，立即生效并持久化）。
   */
  function handleLimitSave() {
    setMaxOutputTokens(Number(limitDraft))
    setLimitDraft(String(clampMaxOutputTokens(Number(limitDraft))))
    setNotice({ ok: true, text: '输出上限已更新' })
  }

  /**
   * 删除配置（确认弹窗；删当前生效配置时 store 会自动切到剩余第一条）。
   *
   * @param profile 目标配置
   */
  function handleRemove(profile: AiProfile) {
    if (!window.confirm(`删除「${profile.name}」？该配置的 Key 将从本机一并清除`)) {
      return
    }
    removeProfile(profile.id)
    setNotice({ ok: true, text: '已删除该配置' })
  }

  return (
    <section className="settings-section" aria-label="AI 服务" id={id}>
      <h2 className="settings-section__title">AI 服务</h2>
      <p className="settings-section__hint">
        用于分享文案与骑行解读的 AI 生成。可以添加多套供应商配置、一键切换使用的配置；
        Key 只保存在本机浏览器，不会随数据导出，更不会上传到本站。
      </p>

      <div className="ai-service__list-head">
        <h3 className="ai-service__list-title">已添加的配置（{profiles.length}）</h3>
        <button
          type="button"
          className="settings-button settings-button--primary"
          onClick={() => {
            setEditingId(null)
            setEditorOpen(true)
          }}
        >
          ＋ 添加供应商
        </button>
      </div>

      <div className="ai-service__profiles">
        {profiles.length === 0 ? (
          <div className="ai-service__empty">
            还没有配置：点上方「添加供应商」，选模板 → 贴 Key 即可
          </div>
        ) : (
          profiles.map((profile) => {
            const isActive = profile.id === activeProfileId
            return (
              <div
                key={profile.id}
                className={isActive ? 'ai-service__profile ai-service__profile--active' : 'ai-service__profile'}
              >
                <div className="ai-service__profile-main">
                  <div className="ai-service__profile-name">
                    {profile.name}
                    <span className="ai-service__provider-tag">
                      {getAiVendor(profile.vendorId)?.name ?? '自定义'}
                    </span>
                    {isActive && <span className="ai-service__active-badge">使用中</span>}
                  </div>
                  <div className="ai-service__profile-meta">
                    {profile.baseUrl} · 模型 <strong>{profile.model}</strong> · Key {maskKey(profile.apiKey)}
                  </div>
                </div>
                <div className="ai-service__profile-actions">
                  {isActive ? null : (
                    <button
                      type="button"
                      className="settings-button"
                      onClick={() => {
                        setActiveProfile(profile.id)
                        setNotice({ ok: true, text: `已切换使用「${profile.name}」` })
                      }}
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => {
                      setEditingId(profile.id)
                      setEditorOpen(true)
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="settings-button settings-button--danger"
                    onClick={() => handleRemove(profile)}
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {editorOpen && <ProfileEditor editingId={editingId} onClose={() => setEditorOpen(false)} />}

      {/* 单次输出上限（v4）：含思考过程的硬顶，防失控调用 */}
      <div className="settings-field ai-service__limit-row">
        <label className="settings-field__label" htmlFor="ai-service-limit">
          单次输出上限
        </label>
        <input
          id="ai-service-limit"
          type="number"
          min={200}
          max={64000}
          step={500}
          className="settings-field__input settings-field__input--number"
          value={limitDraft}
          onChange={(event) => setLimitDraft(event.target.value)}
        />
        <span className="settings-field__unit">token</span>
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            setLimitDraft(String(DEFAULT_MAX_OUTPUT_TOKENS))
            setMaxOutputTokens(DEFAULT_MAX_OUTPUT_TOKENS)
          }}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="settings-button settings-button--primary"
          onClick={handleLimitSave}
          disabled={limitDraft === String(maxOutputTokens)}
        >
          保存上限
        </button>
      </div>
      <p className="ai-service__hint" style={{ margin: '4px 0 0' }}>
        单次生成的输出上限（含思考过程），到达即截断并提示；覆盖文案 / 解读 / 洞察增强等所有
        AI 生成，按实际用量计费，上限本身不产生费用。默认 {DEFAULT_MAX_OUTPUT_TOKENS}。
      </p>

      {notice !== null && (
        <p
          role="status"
          className={
            notice.ok
              ? 'settings-message settings-message--success'
              : 'settings-message settings-message--error'
          }
        >
          {notice.text}
        </p>
      )}

      <div className="ai-service__status">
        <span>
          <span className={activeProfile !== undefined ? 'ai-service__dot ai-service__dot--on' : 'ai-service__dot'} />
          {activeProfile !== undefined
            ? `当前生效：${activeProfile.name}（${getAiVendor(activeProfile.vendorId)?.name ?? '自定义'} / ${activeProfile.model}）`
            : '未配置'}
        </span>
        <span>
          数据上行：<strong>仅聚合指标</strong>（距离 / 爬升 / 功率等汇总数字）
        </span>
      </div>
      <p className="ai-service__privacy">
        隐私边界：AI 只接收聚合指标，GPS 轨迹点与逐点心率不出本机；所有 AI 功能默认关闭，
        添加并启用配置后按需使用；解读结果按活动缓存，不重复计费。
      </p>

      {/* 诊断日志（2.84.0）：本机 AI 调用留痕，排查「起名失败」这类问题用；
          不含提示词正文与 Key，独立 localStorage 键不随数据备份导出 */}
      <details
        className="ai-service__debug"
        aria-label="AI 诊断日志"
        onToggle={(event) => {
          // 展开时刷新（掘取最新留痕；RSForm details toggle 事件带旧态，读 newState）
          if ((event.target as HTMLDetailsElement).open) {
            setDebugEntries(listAiDebugLog())
          }
        }}
      >
        <summary>诊断日志（本机最近 200 条 · 不含提示词与密钥）</summary>
        <div className="ai-service__debug-body">
          <div className="ai-service__debug-toolbar">
            <label className="ai-service__debug-filter">
              <input
                type="checkbox"
                checked={debugErrorsOnly}
                onChange={(event) => setDebugErrorsOnly(event.target.checked)}
              />
              仅看失败
            </label>
            <span className="ai-service__debug-spacer" />
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(JSON.stringify(debugEntries, null, 2))
                  .then(() => setDebugNotice('已复制到剪贴板。'))
                  .catch(() => setDebugNotice('复制失败：浏览器未授权剪贴板。'))
              }}
            >
              复制
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                if (window.confirm('确定清空全部 AI 诊断日志？')) {
                  clearAiDebugLog()
                  setDebugEntries([])
                  setDebugNotice('已清空。')
                }
              }}
            >
              清空
            </button>
          </div>
          {debugNotice !== null && <p className="ai-service__debug-notice">{debugNotice}</p>}
          {debugEntries.length === 0 ? (
            <p className="ai-service__debug-empty">暂无记录。使用任一 AI 功能后这里会出现调用留痕。</p>
          ) : debugView.length === 0 ? (
            <p className="ai-service__debug-empty">筛选条件下没有记录。</p>
          ) : (
            <div className="ai-service__debug-scroll">
              <table className="ai-service__debug-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>功能</th>
                    <th>模型</th>
                    <th>结果</th>
                    <th>耗时</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {debugView.map((entry) => (
                    <tr key={`${entry.ts}-${entry.feature}`}>
                      <td className="num">{new Date(entry.ts).toLocaleTimeString()}</td>
                      <td>{entry.feature}</td>
                      <td className="mono">{entry.model}</td>
                      <td>
                        <span className={entry.status === 'ok' ? 'ai-service__tag ai-service__tag--ok' : 'ai-service__tag ai-service__tag--err'}>
                          {entry.status === 'ok' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="num">{(entry.durationMs / 1000).toFixed(1)}s</td>
                      <td className="mono">
                        {entry.status === 'error' ? (entry.detail ?? '未知原因') : entry.outputChars !== undefined ? `输出 ${entry.outputChars} 字` : '——'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </section>
  )
}

/** 编辑器 props */
interface ProfileEditorProps {
  /** 编辑目标配置 id（null = 添加模式） */
  editingId: string | null

  /** 关闭编辑器（保存成功 / 取消） */
  onClose: () => void
}

/**
 * 添加 / 编辑供应商配置表单。
 *
 * @param props 组件参数
 */
function ProfileEditor({ editingId, onClose }: ProfileEditorProps) {
  const existing = useAiConfigStore((state) => state.profiles).find(
    (profile) => profile.id === editingId,
  )
  const addProfile = useAiConfigStore((state) => state.addProfile)
  const updateProfile = useAiConfigStore((state) => state.updateProfile)

  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [model, setModel] = useState(existing?.model ?? '')
  const [keyVisible, setKeyVisible] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<readonly string[]>([])
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle')
  const [fetchMessage, setFetchMessage] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined)
  const [showMore, setShowMore] = useState(false)
  const [presetCat, setPresetCat] = useState<'all' | AiVendorCategory>('all')
  const [presetSearch, setPresetSearch] = useState('')

  const vendor = vendorId.length > 0 ? getAiVendor(vendorId) : undefined
  const isCustom = vendorId === CUSTOM_VENDOR_ID

  /** 表单是否可保存（custom 要求地址；其余字段通用） */
  const canSave =
    vendor !== undefined &&
    name.trim().length > 0 &&
    (isCustom || baseUrl.trim().length > 0) &&
    apiKey.trim().length >= MIN_API_KEY_LENGTH &&
    model.trim().length > 0

  /** 草稿请求配置（测试 / 拉取模型列表用；不落库） */
  function draftConfig(): {
    baseUrl: string
    apiKey: string
    model: string
    extraHeaders?: Record<string, string>
  } | null {
    if (vendor === undefined) {
      return null
    }
    const resolvedBaseUrl = normalizeAiBaseUrl(baseUrl, isCustom)
    if (resolvedBaseUrl.length === 0 || apiKey.trim().length === 0) {
      return null
    }
    return {
      baseUrl: resolvedBaseUrl,
      apiKey: apiKey.trim(),
      model: model.trim(),
      extraHeaders: vendor.extraHeaders,
    }
  }

  /** 选中模板：地址带出、名称缺省带出、模型取模板默认 */
  function handlePickTemplate(template: AiVendorPreset) {
    setVendorId(template.id)
    setBaseUrl(template.baseUrl)
    if (name.trim().length === 0) {
      setName(template.name)
    }
    setModel(template.models[0] ?? '')
    setFetchedModels([])
    setFetchStatus('idle')
    setFetchMessage('')
    setTestStatus('idle')
    setTestMessage('')
  }

  /** 获取模型列表：GET /models 填充 datalist */
  async function handleFetchModels() {
    const config = draftConfig()
    if (config === null) {
      setFetchStatus('fail')
      setFetchMessage('请先填好接口地址与 Key')
      return
    }
    setFetchStatus('fetching')
    setFetchMessage('')
    try {
      const models = await fetchAiModelList(config)
      setFetchedModels(models)
      // 当前模型不在列表里时自动落到第一项，引导用户选择
      if (!models.includes(model.trim()) && models.length > 0) {
        setModel(models[0])
      }
      setFetchStatus('ok')
      setFetchMessage(`已获取 ${models.length} 个模型，在模型框下拉选择；部分平台带 :free 后缀的是免费档`)
    } catch (error) {
      setFetchStatus('fail')
      setFetchMessage(error instanceof Error ? error.message : '获取模型列表失败，可手填模型名')
    }
  }

  /** 连接测试（HTTP 200 即成功，思考型模型空正文也算通） */
  async function handleTest() {
    const config = draftConfig()
    if (config === null || model.trim().length === 0) {
      setTestStatus('fail')
      setTestMessage('请先填好接口地址、Key 与模型')
      return
    }
    setTestStatus('testing')
    setTestMessage('')
    try {
      const latency = await testAiConnection(config)
      setTestLatency(latency)
      setTestStatus('ok')
    } catch (error) {
      setTestStatus('fail')
      setTestMessage(error instanceof Error ? error.message : '连接失败，请重试')
    }
  }

  /** 保存：归一化地址后写入 store（首个配置自动启用） */
  function handleSave() {
    if (vendor === undefined || !canSave) {
      return
    }
    const payload = {
      name: name.trim(),
      vendorId,
      baseUrl: normalizeAiBaseUrl(baseUrl, isCustom),
      apiKey: apiKey.trim(),
      model: model.trim(),
    }
    if (editingId !== null) {
      updateProfile(editingId, payload)
    } else {
      addProfile(payload)
    }
    onClose()
  }

  /** 模型候选：模板预设 + 已拉取列表去重 */
  const modelOptions = useMemo(() => {
    const merged = [...(vendor?.models ?? []), ...fetchedModels]
    return [...new Set(merged)]
  }, [vendor, fetchedModels])

  /** 「更多供应商」过滤结果（名称 / 域名搜索 + 分类） */
  const libraryResults = useMemo(() => {
    return AI_PRESET_LIBRARY.filter((preset) => {
      if (presetCat !== 'all' && preset.category !== presetCat) {
        return false
      }
      if (presetSearch.trim().length === 0) {
        return true
      }
      const query = presetSearch.trim().toLowerCase()
      return (
        preset.name.toLowerCase().includes(query) || preset.baseUrl.toLowerCase().includes(query)
      )
    })
  }, [presetCat, presetSearch])

  /** 字段变更后重置测试与提示状态（内容变了旧提示不再可信） */
  function resetTransientState() {
    setTestStatus('idle')
    setTestMessage('')
    setFetchStatus('idle')
    setFetchMessage('')
  }

  return (
    <div className="ai-service__editor">
      <h3 className="ai-service__editor-title">{editingId !== null ? '编辑供应商' : '添加供应商'}</h3>

      <div className="ai-service__templates">
        {AI_COMMON_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={
              vendorId === template.id
                ? 'ai-service__provider ai-service__provider--active'
                : 'ai-service__provider'
            }
            aria-pressed={vendorId === template.id}
            onClick={() => handlePickTemplate(template)}
          >
            <span className="ai-service__provider-name">
              {template.name}
              {template.extraHeaders !== undefined && (
                <span className="ai-service__provider-tag">需专用请求头</span>
              )}
            </span>
            <span className="ai-service__provider-desc">{template.desc}</span>
          </button>
        ))}
        <button type="button" className="ai-service__provider" onClick={() => setShowMore((current) => !current)}>
          <span className="ai-service__provider-name">更多供应商（{AI_PRESET_LIBRARY.length}）</span>
          <span className="ai-service__provider-desc">
            {showMore ? '收起' : '官方厂商 / 聚合平台 / 中转站，支持搜索'}
          </span>
        </button>
      </div>

      {showMore && (
        <div className="ai-service__more-panel">
          <div className="settings-field">
            <input
              type="text"
              className="settings-field__input"
              placeholder="搜索名称或域名，如 openrouter / 硅基"
              value={presetSearch}
              onChange={(event) => setPresetSearch(event.target.value)}
            />
          </div>
          <div className="ai-service__cat-chips">
            {(['all', 'official', 'aggregator', 'relay'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={
                  presetCat === cat
                    ? 'settings-button settings-button--primary ai-service__cat-chip'
                    : 'settings-button ai-service__cat-chip'
                }
                onClick={() => setPresetCat(cat)}
              >
                {cat === 'all' ? `全部（${AI_PRESET_LIBRARY.length}）` : AI_VENDOR_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <div className="ai-service__preset-rows">
            {libraryResults.length === 0 ? (
              <div className="ai-service__empty">没有匹配的供应商，可用「自定义 / 中转」手填</div>
            ) : (
              libraryResults.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={
                    vendorId === preset.id
                      ? 'ai-service__preset-row ai-service__preset-row--active'
                      : 'ai-service__preset-row'
                  }
                  onClick={() => handlePickTemplate(preset)}
                >
                  <span className="ai-service__preset-name">{preset.name}</span>
                  <span className="ai-service__preset-url">{preset.baseUrl}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="settings-fields ai-service__fields">
        <div className="settings-field">
          <label className="settings-field__label" htmlFor="ai-profile-name">
            名称
          </label>
          <input
            id="ai-profile-name"
            type="text"
            className="settings-field__input"
            placeholder="如：OpenRouter 免费档"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              resetTransientState()
            }}
          />
        </div>
        <div className="settings-field">
          <label className="settings-field__label" htmlFor="ai-profile-base-url">
            接口地址
          </label>
          <input
            id="ai-profile-base-url"
            type="text"
            className="settings-field__input"
            placeholder={isCustom ? '以 /v1 结尾，未带时自动补齐' : '选模板后自动预填'}
            value={baseUrl}
            disabled={vendor !== undefined && !isCustom}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              resetTransientState()
            }}
          />
          <span className="ai-service__hint">
            {vendor !== undefined && !isCustom ? '模板已预填' : '服务商提供的 OpenAI 兼容地址'}
          </span>
        </div>
        <div className="settings-field">
          <label className="settings-field__label" htmlFor="ai-profile-key">
            API Key
          </label>
          <span className="ai-service__key-wrap">
            <input
              id="ai-profile-key"
              type={keyVisible ? 'text' : 'password'}
              className="settings-field__input"
              placeholder="粘贴服务商控制台里的密钥，仅存本机"
              autoComplete="off"
              value={apiKey}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setApiKey(event.target.value)
                resetTransientState()
              }}
            />
            <button type="button" className="settings-button" onClick={() => setKeyVisible((current) => !current)}>
              {keyVisible ? '隐藏' : '显示'}
            </button>
          </span>
        </div>
        <div className="settings-field">
          <label className="settings-field__label" htmlFor="ai-profile-model">
            模型
          </label>
          <span className="ai-service__key-wrap">
            <input
              id="ai-profile-model"
              type="text"
              className="settings-field__input"
              list="ai-profile-model-options"
              placeholder="可手填，或点右侧获取后下拉选择"
              value={model}
              onChange={(event) => {
                setModel(event.target.value)
                resetTransientState()
              }}
            />
            <datalist id="ai-profile-model-options">
              {modelOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <button
              type="button"
              className="settings-button"
              onClick={() => void handleFetchModels()}
              disabled={fetchStatus === 'fetching' || apiKey.trim().length === 0 || baseUrl.trim().length === 0}
            >
              {fetchStatus === 'fetching' ? '获取中…' : '获取模型列表'}
            </button>
          </span>
        </div>
        <div className="settings-field">
          <span className="settings-field__label">连接测试</span>
          <button
            type="button"
            className="settings-button"
            onClick={() => void handleTest()}
            disabled={testStatus === 'testing' || !canSave}
          >
            {testStatus === 'testing' ? '测试中…' : '测试连接'}
          </button>
          <span className="ai-service__hint">发送一条极小请求验证 Key 可用</span>
        </div>
      </div>

      {fetchMessage.length > 0 && (
        <p
          role="status"
          className={
            fetchStatus === 'fail'
              ? 'settings-message settings-message--error'
              : 'settings-message settings-message--success'
          }
        >
          {fetchMessage}
        </p>
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
          {testStatus === 'ok' ? `连接成功 · ${model} 可用 · 延迟 ${testLatency ?? 0} ms` : testMessage}
        </p>
      )}

      <div className="settings-form__actions ai-service__form-actions">
        <button type="button" className="settings-button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="settings-button settings-button--primary"
          onClick={handleSave}
          disabled={!canSave}
        >
          保存
        </button>
      </div>
    </div>
  )
}

export default AiSettingsSection
