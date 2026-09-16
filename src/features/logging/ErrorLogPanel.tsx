/**
 * 错误日志面板（设置页「更多 → 错误日志」）。
 *
 * 展示本地留存的运行时错误（error_logs 表），支持展开堆栈/上下文、
 * 导出 JSON 与清空。用途：用户报障时可把导出文件发给开发者，不必守着控制台。
 *
 * 面板只做展示与清理，采集逻辑见 features/logging/errorLog.ts。
 */
import { useCallback, useEffect, useState } from 'react'
import type { CyclingDatabase } from '@/storage/db'
import { db as defaultDb } from '@/storage/db'
import {
  clearErrorLogs,
  exportErrorLogs,
  listErrorLogs,
  type ErrorLogEntry,
} from '@/features/logging/errorLog'
import '@/features/logging/errorLogPanel.css'

/** 面板最多展示的条数（库里可留 500，面板只翻最近 100 条避免长列表卡顿） */
const PANEL_LIMIT = 100

/** 错误日志面板 props */
export interface ErrorLogPanelProps {
  /** 数据库实例（测试注入；缺省全局单例） */
  db?: CyclingDatabase
}

/** 本地时间展示（YYYY-MM-DD HH:mm:ss） */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 错误日志面板：列表 + 展开详情 + 导出 / 清空。
 *
 * @param props 组件参数
 */
export function ErrorLogPanel({ db = defaultDb }: ErrorLogPanelProps) {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setEntries(await listErrorLogs(PANEL_LIMIT, db))
    setLoading(false)
  }, [db])

  // 首次加载走异步 IIFE：effect 体内同步 setState 会触发级联渲染（lint 规则）
  useEffect(() => {
    void (async () => {
      setEntries(await listErrorLogs(PANEL_LIMIT, db))
      setLoading(false)
    })()
  }, [db])

  /** 导出为 JSON 文件下载 */
  const handleExport = async () => {
    setBusy(true)
    try {
      const text = await exportErrorLogs(db)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `cycling-error-log-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  /** 清空全部日志 */
  const handleClear = async () => {
    setBusy(true)
    try {
      await clearErrorLogs(db)
      setExpandedId(undefined)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="error-log">
      <div className="error-log__toolbar">
        <span className="error-log__count">
          {loading ? '读取中…' : `共 ${entries.length} 条（最多展示最近 ${PANEL_LIMIT} 条）`}
        </span>
        <div className="error-log__actions">
          <button type="button" className="error-log__button" onClick={() => void refresh()} disabled={busy}>
            刷新
          </button>
          <button
            type="button"
            className="error-log__button"
            onClick={() => void handleExport()}
            disabled={busy || entries.length === 0}
          >
            导出
          </button>
          <button
            type="button"
            className="error-log__button error-log__button--danger"
            onClick={() => void handleClear()}
            disabled={busy || entries.length === 0}
          >
            清空
          </button>
        </div>
      </div>

      {!loading && entries.length === 0 && (
        <p className="error-log__empty">暂无错误记录。运行中的报错会自动记到这里，便于事后查看与导出。</p>
      )}

      <ul className="error-log__list">
        {entries.map((entry) => (
          <li key={entry.id} className="error-log__item">
            <button
              type="button"
              className="error-log__summary"
              aria-expanded={expandedId === entry.id}
              onClick={() => setExpandedId(expandedId === entry.id ? undefined : entry.id)}
            >
              <span className={`error-log__level error-log__level--${entry.level}`}>
                {entry.level === 'warn' ? '警告' : '错误'}
              </span>
              <span className="error-log__time">{formatTime(entry.createdAt)}</span>
              <span className="error-log__source">{entry.source}</span>
              <span className="error-log__message">{entry.message}</span>
            </button>
            {expandedId === entry.id && (
              <div className="error-log__detail">
                <dl className="error-log__meta">
                  {entry.path !== undefined && (
                    <div>
                      <dt>页面</dt>
                      <dd>{entry.path}</dd>
                    </div>
                  )}
                  {entry.appVersion !== undefined && (
                    <div>
                      <dt>版本</dt>
                      <dd>{entry.appVersion}</dd>
                    </div>
                  )}
                </dl>
                {entry.context !== undefined && (
                  <pre className="error-log__block">{entry.context}</pre>
                )}
                {entry.stack !== undefined && <pre className="error-log__block">{entry.stack}</pre>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ErrorLogPanel
