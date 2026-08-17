/**
 * 导入入口面板（规格 §6.1/§7/§9/§22）。
 *
 * 三个入口：目录选择（File System Access API，降级 webkitdirectory）、
 * 文件选择、拖拽区——统一经 scanner 归一化后进入导入 store。
 * 面板只负责交互与状态呈现，导入逻辑在 importer 中（通过 importStore 编排）。
 */
import { useRef, useState, type InputHTMLAttributes } from 'react'

/** TS DOM 类型未包含 showDirectoryPicker（File System Access API），此处补充 */
interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}
import { collectFitFiles, scanDirectory, scanFilesLegacy, type ScanResult } from './scanner'
import { parseStravaActivitiesCsv, type StravaActivityMeta } from './stravaExport'
import type { ImportFile } from './importer'
import { useImportStore } from '@/stores/importStore'
import './ImportPanel.css'

/**
 * 导入入口面板（挂载于侧边栏底部）。
 */
function ImportPanel() {
  const importing = useImportStore((state) => state.importing)
  const progress = useImportStore((state) => state.progress)
  const summary = useImportStore((state) => state.summary)
  const errors = useImportStore((state) => state.errors)
  const startImport = useImportStore((state) => state.startImport)
  const retryFailed = useImportStore((state) => state.retryFailed)
  const reset = useImportStore((state) => state.reset)

  /** 入口区是否展开 */
  const [open, setOpen] = useState(false)
  /** 拖拽区高亮 */
  const [dragActive, setDragActive] = useState(false)
  /** 非文件级提示（如未找到 FIT 文件） */
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  /**
   * 将扫描结果送入导入 store（无 FIT 文件时仅提示）。
   *
   * @param result 扫描结果
   */
  async function runScan(result: ScanResult): Promise<void> {
    if (result.files.length === 0) {
      setNotice('未找到 FIT 文件')
      return
    }
    const files: ImportFile[] = result.files.map((scanned) => ({
      path: scanned.path,
      name: scanned.name,
      file: scanned.file,
    }))
    let stravaCsv: Map<string, StravaActivityMeta> | undefined
    if (result.csvFile) {
      stravaCsv = parseStravaActivitiesCsv(await result.csvFile.text())
    }
    setNotice('')
    await startImport(files, stravaCsv ? { stravaCsv } : undefined)
  }

  /**
   * 目录选择：优先 File System Access API，失败/不支持时回退传统目录输入。
   */
  async function pickDirectory(): Promise<void> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      // 不支持 File System Access API（非安全上下文等）：回退传统目录选择
      dirInputRef.current?.click()
      return
    }
    try {
      const handle = await picker()
      await runScan(await scanDirectory(handle))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return // 用户取消选择
      }
      // 调用失败（权限/兼容问题）：回退传统目录选择
      dirInputRef.current?.click()
    }
  }

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="import-panel">
      <button
        type="button"
        className="import-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        同步骑行数据
      </button>

      {open && !importing && (
        <div className="import-panel__entries">
          <button type="button" className="import-panel__entry" onClick={() => void pickDirectory()}>
            选择目录
          </button>
          <button
            type="button"
            className="import-panel__entry"
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
          <div
            className={`import-panel__dropzone${dragActive ? ' import-panel__dropzone--active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              void runScan(collectFitFiles(event.dataTransfer.files))
            }}
          >
            拖拽 FIT 文件到此处
          </div>
        </div>
      )}

      {/* 隐藏输入：文件选择与 webkitdirectory 目录回退 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".fit,.fit.gz"
        className="import-panel__hidden-input"
        onChange={(event) => {
          const result = collectFitFiles(event.target.files ?? [])
          event.target.value = ''
          if (result.files.length > 0) {
            void runScan(result)
          }
        }}
      />
      {/* React 19 类型未含 webkitdirectory 非标准属性，经 spread 传入 */}
      <input
        ref={dirInputRef}
        type="file"
        multiple
        className="import-panel__hidden-input"
        {...({ webkitdirectory: '' } as InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) => {
          const files = event.target.files
          event.target.value = ''
          if (files && files.length > 0) {
            void runScan(scanFilesLegacy(files))
          }
        }}
      />

      {notice && <p className="import-panel__notice">{notice}</p>}

      {importing && (
        <div className="import-panel__progress">
          <div className="import-panel__progress-bar">
            <div className="import-panel__progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="import-panel__progress-text">
            已处理 {progress.current}/{progress.total}
          </span>
        </div>
      )}

      {summary && (
        <div className="import-panel__result">
          <div className="import-panel__result-head">
            <p className="import-panel__summary-text">
              发现 {summary.total} 个 FIT 文件，新增 {summary.newImported} 个，
              已存在 {summary.skipped} 个，失败 {summary.failed} 个
            </p>
            <button
              type="button"
              className="import-panel__dismiss"
              aria-label="清除导入结果"
              onClick={reset}
            >
              ×
            </button>
          </div>
          {summary.failedItems.length > 0 && (
            <>
              <ul className="import-panel__failures">
                {summary.failedItems.map((item, index) => (
                  <li key={index} className="import-panel__failure" title={item.error}>
                    <span className="import-panel__failure-name">{item.fileName}</span>
                    {item.error}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="import-panel__retry"
                onClick={() => void retryFailed()}
                disabled={importing}
              >
                重试失败文件
              </button>
            </>
          )}
        </div>
      )}

      {errors.length > 0 && <p className="import-panel__error">{errors.join('；')}</p>}
    </div>
  )
}

export default ImportPanel
