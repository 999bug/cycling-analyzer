/**
 * 设置页（规格 §27/§32/§33）。
 *
 * 个人信息表单（昵称/体重/身高/FTP/最大心率/静息心率）+ 单位偏好
 * （距离 km/mi、时间 24h/12h，默认公制）统一由「保存设置」按钮提交；
 * 数据管理区提供导出 JSON 备份、导入 JSON（fingerprint 去重合并）、
 * 清空全部本地数据（二次确认，规格 §32）。
 *
 * 依赖可注入（测试传独立仓库/数据库实例），缺省使用全局数据库单例。
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { db, type CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository, type ActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository, type FileRepository } from '@/storage/repositories/fileRepository'
import { DexieSettingsRepository, type SettingsRepository } from '@/storage/repositories/settingsRepository'
import {
  DEFAULT_UNITS,
  getSettings,
  saveSettings,
  type DistanceUnit,
  type Theme,
  type TimeFormat,
} from '@/features/settings/settings'
import { switchTheme, applyTheme } from '@/features/settings/theme'
import { useDataSourceStore } from '@/stores/dataSourceStore'
import {
  defaultExportFilename,
  downloadJson,
  exportData,
  importBundle,
  parseExportBundle,
} from '@/features/settings/exportImport'
import { clearAllData } from '@/features/settings/dataClear'
import { buildPowerCurve } from '@/features/analysis/powerCurve'
import {
  ESTIMATE_WINDOW_DAYS,
  FTP_POWER_DURATION_SECONDS,
  VO2MAX_POWER_DURATION_SECONDS,
  estimateFtp,
  estimateVo2max,
} from '@/features/analysis/ftpEstimate'
import '@/features/settings/settings-page.css'

/** 清空确认文案（规格 §32 二次确认） */
const CLEAR_ALL_CONFIRM_TEXT = '确定清空全部本地数据？此操作不可恢复'

/** 一天的毫秒数（估算窗口换算） */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** FTP/VO2Max 估算状态（loading=扫描中，noPower=近 90 天无功率数据） */
type EstimateStatus = 'loading' | 'noPower' | 'ready' | 'error'

/** 操作结果提示 */
type FormMessage = { type: 'success' | 'error'; text: string }

/** 设置页依赖（测试可整体注入独立数据库） */
interface SettingsPageProps {
  /** 数据库实例（导出/导入/清空涉及表级读写；缺省全局单例） */
  db?: CyclingDatabase

  /** 活动仓库（缺省全局单例） */
  activityRepository?: ActivityRepository

  /** 文件台账仓库（缺省全局单例） */
  fileRepository?: FileRepository

  /** 设置仓库（缺省全局单例） */
  settingsRepository?: SettingsRepository
}

/**
 * 设置页。
 */
function SettingsPage({ db: dbProp, activityRepository, fileRepository, settingsRepository }: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 作者显示名（「关于」区块；未探测到时回退「作者」）
  const authorName = useDataSourceStore((s) => s.authorName)

  // 页面依赖上下文：优先注入值，缺省使用全局数据库单例
  const context = useMemo(
    () => ({
      db: dbProp ?? db,
      activityRepository: activityRepository ?? new DexieActivityRepository(dbProp ?? db),
      fileRepository: fileRepository ?? new DexieFileRepository(dbProp ?? db),
      settingsRepository: settingsRepository ?? new DexieSettingsRepository(dbProp ?? db),
    }),
    [dbProp, activityRepository, fileRepository, settingsRepository],
  )

  // 个人信息表单（数字字段以字符串保存，空串 = 未设置）
  const [nickname, setNickname] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [ftp, setFtp] = useState('')
  const [maxHeartRate, setMaxHeartRate] = useState('')
  const [restingHeartRate, setRestingHeartRate] = useState('')

  // 单位偏好
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(DEFAULT_UNITS.distance)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_UNITS.timeFormat)

  // 外观偏好（主题切换立即生效并保存，规格 §36）
  const [theme, setTheme] = useState<Theme>('dark')

  // 导入偏好（保存原始 FIT 文件开关，规格 §19 默认不保存）
  const [saveOriginalFit, setSaveOriginalFit] = useState(false)

  // 操作状态
  const [message, setMessage] = useState<FormMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)

  // FTP/VO2Max 估算（规格 §39）：近 90 天功率数据异步扫描
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus>('loading')
  const [ftpEstimate, setFtpEstimate] = useState<number>()
  const [vo2maxEstimate, setVo2maxEstimate] = useState<number>()
  const [adopting, setAdopting] = useState(false)

  // 加载设置并回填表单（规格 §27 默认公制）
  useEffect(() => {
    let cancelled = false
    getSettings(context.settingsRepository)
      .then((data) => {
        if (cancelled) {
          return
        }
        setNickname(data.profile.nickname ?? '')
        setWeightKg(numberToString(data.profile.weightKg))
        setHeightCm(numberToString(data.profile.heightCm))
        setFtp(numberToString(data.profile.ftp))
        setMaxHeartRate(numberToString(data.profile.maxHeartRate))
        setRestingHeartRate(numberToString(data.profile.restingHeartRate))
        setDistanceUnit(data.units.distance)
        setTimeFormat(data.units.timeFormat)
        setTheme(data.appearance.theme)
        setSaveOriginalFit(data.import.saveOriginalFit)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage({ type: 'error', text: '设置加载失败，请刷新重试' })
        }
        console.error('Failed to load settings', error)
      })
    return () => {
      cancelled = true
    }
  }, [context.settingsRepository])

  // FTP/VO2Max 估算：扫描近 90 天含功率的活动，取 5 分钟/20 分钟最佳功率
  useEffect(() => {
    let cancelled = false

    /**
     * 扫描近 90 天功率数据并计算估算值（体重取自已保存设置）。
     */
    async function scanBestPowers() {
      const cutoffIso = new Date(Date.now() - ESTIMATE_WINDOW_DAYS * MS_PER_DAY).toISOString()
      const [settingsData, summaries] = await Promise.all([
        getSettings(context.settingsRepository),
        context.activityRepository.listAllSummaries(),
      ])
      const powered = summaries.filter(
        (summary) => summary.avgPower !== undefined && summary.startTime >= cutoffIso,
      )

      // 合并各活动的 5 分钟/20 分钟最佳功率（跨活动取最大）
      const best = new Map<number, number>()
      for (const summary of powered) {
        const records = await context.activityRepository.getRecords(summary.id)
        const curve = buildPowerCurve(records, [
          VO2MAX_POWER_DURATION_SECONDS,
          FTP_POWER_DURATION_SECONDS,
        ])
        for (const point of curve) {
          const current = best.get(point.duration)
          if (current === undefined || point.power > current) {
            best.set(point.duration, point.power)
          }
        }
        if (cancelled) {
          return
        }
      }

      if (cancelled) {
        return
      }
      const ftp = estimateFtp(best.get(FTP_POWER_DURATION_SECONDS))
      const vo2max = estimateVo2max(
        best.get(VO2MAX_POWER_DURATION_SECONDS),
        settingsData.profile.weightKg,
      )
      if (ftp === undefined && vo2max === undefined) {
        setEstimateStatus('noPower')
        return
      }
      setFtpEstimate(ftp)
      setVo2maxEstimate(vo2max)
      setEstimateStatus('ready')
    }

    scanBestPowers().catch((error: unknown) => {
      if (!cancelled) {
        setEstimateStatus('error')
      }
      console.error('Failed to estimate FTP/VO2Max', error)
    })
    return () => {
      cancelled = true
    }
  }, [context.activityRepository, context.settingsRepository])

  /**
   * 采用估算 FTP：立即保存到设置并回填输入框。
   */
  async function handleAdoptFtp() {
    if (ftpEstimate === undefined || adopting) {
      return
    }
    setAdopting(true)
    try {
      await saveSettings({ profile: { ftp: ftpEstimate } }, context.settingsRepository)
      setFtp(String(ftpEstimate))
      setMessage({ type: 'success', text: `已采用估算 FTP：${ftpEstimate} W` })
    } catch (error) {
      console.error('Failed to adopt estimated FTP', error)
      setMessage({ type: 'error', text: '保存失败，请重试' })
    } finally {
      setAdopting(false)
    }
  }

  /**
   * 保存设置（个人信息 + 单位，合并保存不丢未修改字段）。
   */
  async function handleSave() {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      await saveSettings(
        {
          profile: {
            nickname: nickname.trim() || undefined,
            weightKg: parseOptionalNumber(weightKg),
            heightCm: parseOptionalNumber(heightCm),
            ftp: parseOptionalNumber(ftp),
            maxHeartRate: parseOptionalNumber(maxHeartRate),
            restingHeartRate: parseOptionalNumber(restingHeartRate),
          },
          units: { distance: distanceUnit, timeFormat },
        },
        context.settingsRepository,
      )
      setMessage({ type: 'success', text: '设置已保存' })
    } catch (error) {
      console.error('Failed to save settings', error)
      setMessage({ type: 'error', text: '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  /**
   * 导出全部数据为 JSON 备份（规格 §33），触发浏览器下载。
   */
  async function handleExport() {
    if (exporting) {
      return
    }
    setExporting(true)
    try {
      const bundle = await exportData(context)
      downloadJson(bundle)
      setMessage({ type: 'success', text: `数据已导出：${defaultExportFilename(bundle.exportedAt)}` })
    } catch (error) {
      console.error('Failed to export data', error)
      setMessage({ type: 'error', text: '导出失败，请重试' })
    } finally {
      setExporting(false)
    }
  }

  /**
   * 导入 JSON 备份：解析校验 → fingerprint 去重导入（规格 §33）。
   */
  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清空 value 允许再次选择同一文件
    event.target.value = ''
    if (file === undefined || importing) {
      return
    }
    setImporting(true)
    try {
      const bundle = parseExportBundle(await file.text())
      const summary = await importBundle(bundle, context)
      setMessage({ type: 'success', text: `导入完成：新增 ${summary.newImported} 条，跳过 ${summary.skipped} 条` })
    } catch (error) {
      console.error('Failed to import data', error)
      setMessage({ type: 'error', text: '导入失败：文件格式无效或版本不受支持' })
    } finally {
      setImporting(false)
    }
  }

  /**
   * 清空全部本地数据（规格 §32）：二次确认后执行。
   */
  async function handleClearAll() {
    if (clearing) {
      return
    }
    if (!window.confirm(CLEAR_ALL_CONFIRM_TEXT)) {
      return
    }
    setClearing(true)
    try {
      await clearAllData(context)
      resetForm()
      setMessage({ type: 'success', text: '已清空全部本地数据' })
    } catch (error) {
      console.error('Failed to clear all data', error)
      setMessage({ type: 'error', text: '清空失败，请重试' })
    } finally {
      setClearing(false)
    }
  }

  /**
   * 表单提交：回车触发保存。
   */
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void handleSave()
  }

  /**
   * 切换主题：立即应用到文档并持久化（无需点「保存设置」）。
   *
   * @param event 选择事件
   */
  async function handleThemeChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as Theme
    setTheme(next)
    try {
      await switchTheme(next, context.settingsRepository)
      setMessage({
        type: 'success',
        text:
          next === 'light'
            ? '已切换为浅色主题'
            : next === 'dark'
              ? '已切换为深色主题'
              : '已切换为跟随系统主题',
      })
    } catch (error) {
      console.error('Failed to switch theme', error)
      setMessage({ type: 'error', text: '主题保存失败，请重试' })
    }
  }

  /**
   * 切换「保存原始 FIT 文件」：立即持久化（规格 §19）。
   *
   * @param event 选择事件
   */
  async function handleSaveOriginalFitChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked
    setSaveOriginalFit(next)
    try {
      await saveSettings({ import: { saveOriginalFit: next } }, context.settingsRepository)
      setMessage({ type: 'success', text: next ? '已开启：后续导入将保存原始 FIT 文件' : '已关闭：不再保存原始 FIT 文件' })
    } catch (error) {
      console.error('Failed to save import preferences', error)
      setMessage({ type: 'error', text: '保存失败，请重试' })
    }
  }

  /**
   * 清空后重置表单为默认值（规格 §27 默认公制；主题复位深色，规格 §36）。
   */
  function resetForm() {
    setNickname('')
    setWeightKg('')
    setHeightCm('')
    setFtp('')
    setMaxHeartRate('')
    setRestingHeartRate('')
    setDistanceUnit(DEFAULT_UNITS.distance)
    setTimeFormat(DEFAULT_UNITS.timeFormat)
    setTheme('dark')
    applyTheme('dark')
    setSaveOriginalFit(false)
  }

  return (
    <div className="settings-page">
      <h1>设置</h1>

      <form className="settings-form" onSubmit={handleSubmit}>
        <section className="settings-section" aria-label="个人信息">
          <h2 className="settings-section__title">个人信息</h2>
          <p className="settings-section__hint">
            训练配置仅作用于「我的数据」；查看作者数据时使用作者发布的配置。
          </p>
          <div className="settings-fields">
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-nickname">
                昵称
              </label>
              <input
                id="settings-profile-nickname"
                type="text"
                className="settings-field__input"
                placeholder="如：晨骑爱好者"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-weight">
                体重
              </label>
              <input
                id="settings-profile-weight"
                type="number"
                className="settings-field__input settings-field__input--number"
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
              />
              <span className="settings-field__unit">kg</span>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-height">
                身高
              </label>
              <input
                id="settings-profile-height"
                type="number"
                className="settings-field__input settings-field__input--number"
                value={heightCm}
                onChange={(event) => setHeightCm(event.target.value)}
              />
              <span className="settings-field__unit">cm</span>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-ftp">
                FTP
              </label>
              <input
                id="settings-profile-ftp"
                type="number"
                className="settings-field__input settings-field__input--number"
                value={ftp}
                onChange={(event) => setFtp(event.target.value)}
              />
              <span className="settings-field__unit">W</span>
            </div>
            <div className="settings-estimate" aria-label="训练估算">
              {estimateStatus === 'loading' && (
                <p className="settings-estimate__text">正在根据近 90 天的骑行数据估算…</p>
              )}
              {estimateStatus === 'noPower' && (
                <p className="settings-estimate__text">
                  近 90 天没有功率数据，导入含功率计的骑行后可估算 FTP 与 VO2Max
                </p>
              )}
              {estimateStatus === 'error' && (
                <p className="settings-estimate__text">估算失败，请刷新重试</p>
              )}
              {estimateStatus === 'ready' && (
                <>
                  {ftpEstimate !== undefined && (
                    <p className="settings-estimate__text">
                      估算 FTP：{ftpEstimate} W（近 90 天 20 分钟最佳功率 × 0.95）
                      <button
                        type="button"
                        className="settings-button settings-estimate__adopt"
                        onClick={handleAdoptFtp}
                        disabled={adopting}
                      >
                        {adopting ? '采用中…' : '采用'}
                      </button>
                    </p>
                  )}
                  {vo2maxEstimate !== undefined ? (
                    <p className="settings-estimate__text">
                      估算 VO2Max：{vo2maxEstimate} ml/kg/min（5 分钟最佳功率 ÷ 体重）
                    </p>
                  ) : (
                    <p className="settings-estimate__text">填写并保存体重后可估算 VO2Max</p>
                  )}
                </>
              )}
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-max-hr">
                最大心率
              </label>
              <input
                id="settings-profile-max-hr"
                type="number"
                className="settings-field__input settings-field__input--number"
                value={maxHeartRate}
                onChange={(event) => setMaxHeartRate(event.target.value)}
              />
              <span className="settings-field__unit">bpm</span>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-profile-resting-hr">
                静息心率
              </label>
              <input
                id="settings-profile-resting-hr"
                type="number"
                className="settings-field__input settings-field__input--number"
                value={restingHeartRate}
                onChange={(event) => setRestingHeartRate(event.target.value)}
              />
              <span className="settings-field__unit">bpm</span>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-label="单位">
          <h2 className="settings-section__title">单位</h2>
          <div className="settings-fields">
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-unit-distance">
                距离
              </label>
              <select
                id="settings-unit-distance"
                className="settings-field__select"
                value={distanceUnit}
                onChange={(event) => setDistanceUnit(event.target.value as DistanceUnit)}
              >
                <option value="km">公里（km）</option>
                <option value="mi">英里（mi）</option>
              </select>
            </div>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-unit-time">
                时间格式
              </label>
              <select
                id="settings-unit-time"
                className="settings-field__select"
                value={timeFormat}
                onChange={(event) => setTimeFormat(event.target.value as TimeFormat)}
              >
                <option value="24h">24 小时制</option>
                <option value="12h">12 小时制</option>
              </select>
            </div>
          </div>
        </section>

        <div className="settings-form__actions">
          <button type="submit" className="settings-button settings-button--primary" disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </form>

      <section className="settings-section" aria-label="外观">
        <h2 className="settings-section__title">外观</h2>
        <p className="settings-section__hint">主题切换后立即生效并自动保存。</p>
        <div className="settings-fields">
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="settings-appearance-theme">
              主题
            </label>
            <select
              id="settings-appearance-theme"
              className="settings-field__select"
              value={theme}
              onChange={handleThemeChange}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-label="导入">
        <h2 className="settings-section__title">导入</h2>
        <p className="settings-section__hint">
          开启后导入的原始 FIT 字节会保存在浏览器本地（占用存储空间），默认不保存。
        </p>
        <div className="settings-fields">
          <div className="settings-field">
            <span className="settings-field__label">原始文件</span>
            <label className="settings-field__checkbox">
              <input
                type="checkbox"
                checked={saveOriginalFit}
                onChange={handleSaveOriginalFitChange}
              />
              保存原始 FIT 文件
            </label>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-label="数据管理">
        <h2 className="settings-section__title">数据管理</h2>
        <p className="settings-section__hint">
          导出 JSON 备份可迁移到其他设备；导入会合并到当前数据。
          导出/清空仅作用于「我的数据」，不影响作者发布的数据。
        </p>
        <div className="settings-actions">
          <button type="button" className="settings-button" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中…' : '导出数据'}
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? '导入中…' : '导入数据'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="settings-file-input"
            onChange={handleImportFile}
          />
          <button
            type="button"
            className="settings-button settings-button--danger"
            onClick={handleClearAll}
            disabled={clearing}
          >
            {clearing ? '清空中…' : '清空全部本地数据'}
          </button>
        </div>
      </section>

      {message !== null && (
        <p
          role="status"
          className={
            message.type === 'success'
              ? 'settings-message settings-message--success'
              : 'settings-message settings-message--error'
          }
        >
          {message.text}
        </p>
      )}

      <section className="settings-section" aria-label="关于">
        <h2 className="settings-section__title">关于</h2>
        <p className="settings-section__hint">
          本站为 {authorName ?? '作者'} 的公开骑行数据站点：默认展示作者发布的数据（只读快照）。
          你可以通过左侧「同步骑行数据」导入自己的 FIT 文件——
          你的数据仅保存在当前浏览器本地（IndexedDB），不会上传。
        </p>
      </section>
    </div>
  )
}

/**
 * 解析可空正数输入（空串/非法值返回 undefined，即不保存该字段）。
 *
 * @param value 输入框字符串
 * @returns 正数，空或非法时 undefined
 */
function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * 数字转输入框字符串（未设置显示空）。
 *
 * @param value 数字（可为空）
 * @returns 字符串，未设置时 ''
 */
function numberToString(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

export default SettingsPage
