/**
 * 导入入口面板（规格 §6.1/§7/§9/§22）。
 *
 * 入口：目录选择（File System Access API，降级 webkitdirectory）、
 * 文件选择、拖拽区——统一经 scanner 归一化后进入导入 store。
 *
 * 数据源选择（批量导入）：Strava 目录解析 activities.csv 还原标题/描述/估算功率；
 * 佳明/igpsport/行者等来源无 CSV，标题按文件名兜底。
 *
 * 单文件导入：选择单个 FIT 时弹出编辑框（标题/说明/个人备注），确认后入库。
 * 面板只负责交互与状态呈现，导入逻辑在 importer 中（通过 importStore 编排）。
 */
import { useRef, useState, type InputHTMLAttributes } from 'react'

/** TS DOM 类型未包含 showDirectoryPicker（File System Access API），此处补充 */
interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}
import { collectFitFiles, scanDirectory, scanFilesLegacy, type ScanResult } from './scanner'
import { parseStravaActivitiesCsv, titleFromFileName, type StravaActivityMeta } from './stravaExport'
import { DEFAULT_IMPORT_SOURCE, IMPORT_SOURCE_OPTIONS, isStravaSource, type ImportSource } from './importSources'
import type { ImportFile } from './importer'
import ImportEditDialog, { type ImportDraft } from './ImportEditDialog'
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
  /** 批量导入数据源（决定是否解析 Strava CSV） */
  const [source, setSource] = useState<ImportSource>(DEFAULT_IMPORT_SOURCE)
  /** 待编辑的单文件（非空时弹编辑框） */
  const [pendingFile, setPendingFile] = useState<ScanResult['files'][number] | null>(null)
  /** 非文件级提示（如未找到 FIT 文件） */
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  /**
   * 将扫描结果送入导入 store（无 FIT 文件时仅提示）。
   * 数据源为 Strava 时解析目录中的 activities.csv；其他来源跳过（无 CSV 元数据）。
   *
   * @param result 扫描结果
   * @param overrides 单文件编辑的元数据覆盖（标题/描述/备注）
   */
  async function runScan(result: ScanResult, overrides?: Partial<ImportFile>): Promise<void> {
    if (result.files.length === 0) {
      setNotice('未找到 FIT 文件')
      return
    }
    const files: ImportFile[] = result.files.map((scanned) => ({
      path: scanned.path,
      name: scanned.name,
      file: scanned.file,
      ...overrides,
    }))
    let stravaCsv: Map<string, StravaActivityMeta> | undefined
    if (result.csvFile && isStravaSource(source)) {
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

  /**
   * 文件选择：单个文件弹出编辑框（标题/说明/备注），多个文件直接导入。
   *
   * @param files 用户选择的文件列表
   */
  function pickFiles(files: FileList | null): void {
    const result = collectFitFiles(files ?? [])
    if (result.files.length === 0) {
      return
    }
    if (result.files.length === 1) {
      setPendingFile(result.files[0])
      return
    }
    void runScan(result)
  }

  /**
   * 编辑框确认：将手动填写的元数据写入单文件后导入。
   *
   * @param draft 编辑后的标题/描述/备注
   */
  function handleEditConfirm(draft: ImportDraft): void {
    const file = pendingFile
    setPendingFile(null)
    if (file === null) {
      return
    }
    const title = draft.title.trim()
    const description = draft.description.trim()
    const note = draft.note.trim()
    void runScan(
      { files: [file], csvFile: undefined },
      {
        title: title.length > 0 ? title : undefined,
        description: description.length > 0 ? description : undefined,
        note: note.length > 0 ? note : undefined,
      },
    )
  }

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const selectedSource = IMPORT_SOURCE_OPTIONS.find((option) => option.value === source)

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
          <label className="import-panel__source">
            <span className="import-panel__source-label">数据来源</span>
            <select
              className="import-panel__source-select"
              value={source}
              aria-label="批量导入数据来源"
              onChange={(event) => setSource(event.target.value as ImportSource)}
            >
              {IMPORT_SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="import-panel__source-hint">{selectedSource?.hint}</span>
          </label>
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
              const result = collectFitFiles(event.dataTransfer.files)
              if (result.files.length === 1) {
                setPendingFile(result.files[0])
              } else {
                void runScan(result)
              }
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
          const files = event.target.files
          event.target.value = ''
          pickFiles(files)
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

      {pendingFile && (
        <ImportEditDialog
          fileName={pendingFile.name}
          defaultTitle={titleFromFileName(pendingFile.name) ?? ''}
          onConfirm={handleEditConfirm}
          onCancel={() => setPendingFile(null)}
        />
      )}

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