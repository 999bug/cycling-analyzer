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
  type TimeFormat,
} from '@/features/settings/settings'
import {
  defaultExportFilename,
  downloadJson,
  exportData,
  importBundle,
  parseExportBundle,
} from '@/features/settings/exportImport'
import { clearAllData } from '@/features/settings/dataClear'
import '@/features/settings/settings-page.css'

/** 清空确认文案（规格 §32 二次确认） */
const CLEAR_ALL_CONFIRM_TEXT = '确定清空全部本地数据？此操作不可恢复'

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

  // 操作状态
  const [message, setMessage] = useState<FormMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)

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
   * 清空后重置表单为默认值（规格 §27 默认公制）。
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
  }

  return (
    <div className="settings-page">
      <h1>设置</h1>

      <form className="settings-form" onSubmit={handleSubmit}>
        <section className="settings-section" aria-label="个人信息">
          <h2 className="settings-section__title">个人信息</h2>
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

      <section className="settings-section" aria-label="数据管理">
        <h2 className="settings-section__title">数据管理</h2>
        <p className="settings-section__hint">导出 JSON 备份可迁移到其他设备；导入会合并到当前数据。</p>
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
