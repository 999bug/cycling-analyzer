/**
 * 导入入口面板（规格 §6.1/§7/§9/§22）——三步向导版。
 *
 * 第 1 步「选择方式」：直接导入（文件夹/单文件卡片 + 拖拽区）或按平台引导；
 * 第 2 步「导出指引」：按所选平台展示导出步骤（platformGuides.ts，与云端教程同源）；
 * 第 3 步「导入数据」：拖拽/选择目录/选择文件，数据源按所选平台自动确定，
 * 并展示格式说明（FIT 原生无损 / GPX 有损需重新推算）。
 *
 * 入口统一经 scanner 归一化后进入导入 store：
 * - Strava 目录解析 activities.csv 还原标题/描述/估算功率；
 * - 佳明 GDPR 全量包自动展开内层 zip 并解析活动摘要 JSON（按开始时间还原标题）；
 * - 其他平台/直接导入按文件名兜底标题。
 * zip 展开为通用能力：任意入口选中的 .zip 均先解压再分拣（深度 2 层）。
 * 单文件导入无需数据源（格式通用）：选择单个 FIT/GPX 时弹出编辑框（标题/说明/个人备注）。
 * 面板只负责交互与状态呈现，导入逻辑在 importer 中（通过 importStore 编排）。
 */
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/** TS DOM 类型未包含 showDirectoryPicker（File System Access API），此处补充 */
interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}
import {
  collectFitFiles,
  emptyScanResult,
  expandArchives,
  scanDirectory,
  type ScanResult,
} from './scanner';
import { parseGarminSummaries } from './garminExport';
import {
  parseStravaActivitiesCsv,
  readTextAuto,
  titleFromFileName,
  type StravaActivityMeta,
} from './stravaExport';
import { isStravaSource, type ImportSource } from './importSources';
import type { ImportFile } from './importer';
import SourceSelect from '@/features/activity/SourceSelect';
import ImportEditDialog, { type ImportDraft } from './ImportEditDialog';
import PlatformGrid from './PlatformGrid';
import PlatformGuideView from './PlatformGuideView';
import { DIRECT_FORMAT_NOTE, DIRECT_SOURCE_NOTE, PLATFORM_GUIDES, TUTORIAL_URL } from './platformGuides';
import { useImportStore } from '@/stores/importStore';
import { reloadPage } from '@/utils/navigation';
import './ImportPanel.css';

/** 向导步骤 */
type WizardStep = 'choose' | 'guide' | 'import';

/** 步骤条定义（顺序即展示顺序） */
const WIZARD_STEPS: readonly { key: WizardStep; label: string }[] = [
  { key: 'choose', label: '选择方式' },
  { key: 'guide', label: '导出指引' },
  { key: 'import', label: '导入数据' },
];

/**
 * 导入入口面板（挂载于侧边栏底部）。
 */
function ImportPanel() {
  const importing = useImportStore((state) => state.importing);
  const progress = useImportStore((state) => state.progress);
  const summary = useImportStore((state) => state.summary);
  const errors = useImportStore((state) => state.errors);
  const startImport = useImportStore((state) => state.startImport);
  const retryFailed = useImportStore((state) => state.retryFailed);
  const reset = useImportStore((state) => state.reset);

  /** 入口区是否展开（弹窗） */
  const [open, setOpen] = useState(false);
  /** 当前向导步骤 */
  const [step, setStep] = useState<WizardStep>('choose');
  /** 选中的平台指引（null = 直接导入模式，未指定平台） */
  const [selected, setSelected] = useState<(typeof PLATFORM_GUIDES)[number] | null>(null);
  /** 拖拽区高亮 */
  const [dragActive, setDragActive] = useState(false);
  /** 待编辑的单文件（非空时弹编辑框） */
  const [pendingFile, setPendingFile] = useState<ScanResult['files'][number] | null>(null);
  /** 非文件级提示（如未找到 FIT 文件） */
  const [notice, setNotice] = useState('');
  /** 批次级来源覆盖：'auto' = 按文件内容自动识别（默认），否则强制指定来源 App */
  const [batchSourceApp, setBatchSourceApp] = useState('auto');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  /**
   * 本次弹窗打开期间是否有新活动落库（含重试成功）。
   * 新数据已写入 IndexedDB，但各页面列表为挂载时快照——关闭弹窗时据此
   * 决定整页刷新（用户关闭弹窗即看到新数据，无需手动刷新）。
   * 只置位不清零：任何带新数据的关闭路径都以刷新收尾，页面重载后
   * 组件与 store 一并重建，不存在复用旧标记的场景。
   */
  const importedSinceOpenRef = useRef(false);

  // 导入汇总到达即检查新增数：runScan 与「重试失败文件」两条路径统一覆盖
  useEffect(() => {
    if (summary !== null && summary.newImported > 0) {
      importedSinceOpenRef.current = true;
    }
  }, [summary]);

  /** 批量导入数据源：按所选平台自动确定，直接导入模式按文件名兜底 */
  const source: ImportSource = selected?.source ?? 'other';

  /**
   * 将扫描结果送入导入 store（无 FIT 文件时仅提示）。
   * 先展开结果中的 zip 压缩包（佳明 GDPR 内层 zip 等），再按元数据来源还原标题：
   * Strava 源解析 activities.csv；佳明摘要 JSON 自动检测（无需手动选源）。
   *
   * @param result 扫描结果
   * @param overrides 单文件编辑的元数据覆盖（标题/描述/备注）
   */
  async function runScan(result: ScanResult, overrides?: Partial<ImportFile>): Promise<void> {
    await expandArchives(result);
    const warningText = result.warnings.join('；');
    if (result.files.length === 0) {
      setNotice(warningText || '未找到可导入的骑行文件（支持 FIT / GPX / ZIP）');
      return;
    }
    const files: ImportFile[] = result.files.map((scanned) => ({
      path: scanned.path,
      name: scanned.name,
      file: scanned.file,
      ...overrides,
    }));
    let stravaCsv: Map<string, StravaActivityMeta> | undefined;
    if (result.csvFile && isStravaSource(source)) {
      // 编码探测读取：Strava 中文账号导出为 GB18030，固定 UTF-8 会丢表头致标题还原失效
      stravaCsv = parseStravaActivitiesCsv(await readTextAuto(result.csvFile));
    }
    // 佳明 GDPR 摘要：出现即解析（拖拽/zip 场景无数据源选择，按开始时间匹配标题）
    let garminTitles: Map<number, string> | undefined;
    if (result.garminJson) {
      garminTitles = parseGarminSummaries(await result.garminJson.text());
    }
    setNotice(warningText);
    await startImport(files, {
      stravaCsv,
      garminTitles,
      sourceApp: batchSourceApp === 'auto' ? undefined : batchSourceApp,
    });
  }

  /**
   * 目录选择：优先 File System Access API，失败/不支持时回退传统目录输入。
   */
  async function pickDirectory(): Promise<void> {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      // 不支持 File System Access API（非安全上下文等）：回退传统目录选择
      dirInputRef.current?.click();
      return;
    }
    try {
      const handle = await picker();
      await runScan(await scanDirectory(handle));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return; // 用户取消选择
      }
      // 调用失败（权限/兼容问题）：回退传统目录选择
      dirInputRef.current?.click();
    }
  }

  /**
   * 文件/拖拽选择：先展开 zip，再按展开结果分流——
   * 单个文件弹出编辑框（标题/说明/备注），多个文件直接导入，无文件时提示。
   * 注意：FileList 是 live 集合，必须先转数组再重置 input.value，否则引用被清空。
   *
   * @param files 用户选择的文件列表
   */
  async function pickFiles(files: File[]): Promise<void> {
    const result = collectFitFiles(files);
    await expandArchives(result);
    if (result.files.length === 0) {
      setNotice(result.warnings.join('；') || '未找到可导入的骑行文件（支持 FIT / GPX / ZIP）');
      return;
    }
    if (result.files.length === 1) {
      setPendingFile(result.files[0]);
      return;
    }
    setNotice('');
    void runScan(result);
  }

  /** 第 1 步「导入文件夹」卡片：跳到导入步骤并打开目录选择器 */
  function handleDirectFolder(): void {
    setSelected(null);
    setStep('import');
    void pickDirectory();
  }

  /** 第 1 步「导入单个文件」卡片：跳到导入步骤并打开文件选择器 */
  function handleDirectFile(): void {
    setSelected(null);
    setStep('import');
    fileInputRef.current?.click();
  }

  /** 第 1 步平台卡片：进入第 2 步查看该平台导出指引 */
  function handlePlatformSelect(guide: (typeof PLATFORM_GUIDES)[number]): void {
    setSelected(guide);
    setStep('guide');
  }

  /**
   * 编辑框确认：将手动填写的元数据写入单文件后导入。
   *
   * @param draft 编辑后的标题/描述/备注
   */
  function handleEditConfirm(draft: ImportDraft): void {
    const file = pendingFile;
    setPendingFile(null);
    if (file === null) {
      return;
    }
    const title = draft.title.trim();
    const description = draft.description.trim();
    const note = draft.note.trim();
    void runScan(
      { ...emptyScanResult(), files: [file] },
      {
        title: title.length > 0 ? title : undefined,
        description: description.length > 0 ? description : undefined,
        note: note.length > 0 ? note : undefined,
      },
    );
  }

  /**
   * 关闭弹窗（×按钮/遮罩点击/Esc/toggle 共用；导入进行中禁止）。
   *
   * 本次会话有新活动落库时整页刷新：新数据已在 IndexedDB，但仪表盘/
   * 记录/统计等页面的数据是挂载时快照，刷新是让全部页面立即展示新
   * 数据的最直接方式。刷新后组件与 store 重建，不会循环触发。
   */
  const closeDialog = useCallback((): void => {
    if (importing) {
      return;
    }
    if (importedSinceOpenRef.current) {
      reloadPage();
      return;
    }
    setOpen(false);
  }, [importing]);

  /**
   * 弹窗打开时锁定背景滚动（模态语义）。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /**
   * Esc 关闭弹窗（复用 closeDialog：导入进行中禁止关闭，有新数据时刷新页面）。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, closeDialog]);

  /** 步骤条点击：指引步骤需已选平台；导入进行中禁止切换 */
  function handleStepClick(target: WizardStep): void {
    if (importing) {
      return;
    }
    if (target === 'guide' && selected === null) {
      return;
    }
    setStep(target);
  }

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const activeIndex = WIZARD_STEPS.findIndex((s) => s.key === step);

  return (
    <div className="import-panel">
      <button
        type="button"
        className="import-panel__toggle"
        aria-expanded={open}
        onClick={() => (open ? closeDialog() : setOpen(true))}
      >
        同步骑行数据
      </button>

      {open && (
        <div className="import-dialog__backdrop" onClick={closeDialog} role="presentation">
          <div
            className="import-dialog import-dialog--wizard"
            role="dialog"
            aria-modal="true"
            aria-label="同步骑行数据"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="import-dialog__head">
              <span className="import-dialog__title">同步骑行数据</span>
              <button
                type="button"
                className="import-dialog__close"
                aria-label="关闭"
                onClick={closeDialog}
                disabled={importing}
              >
                ×
              </button>
            </div>

            {/* 步骤条：直接导入模式第 2 步标记为「已跳过」 */}
            <div className="import-wz__steps">
              {WIZARD_STEPS.map((s, index) => {
                const skipped = selected === null && s.key === 'guide';
                const state =
                  index === activeIndex ? 'act' : index < activeIndex ? (skipped ? 'skip' : 'done') : '';
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`import-wz__step${state ? ` import-wz__step--${state}` : ''}`}
                    aria-current={index === activeIndex ? 'step' : undefined}
                    onClick={() => handleStepClick(s.key)}
                  >
                    <span className="import-wz__step-num">
                      {skipped && state === 'skip' ? '—' : index + 1}
                    </span>
                    <span className="import-wz__step-label">
                      {s.label}
                      {skipped && state !== 'act' ? '（已跳过）' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="import-dialog__body">
              {step === 'choose' && !importing && (
                <>
                  <p className="import-dialog__privacy">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    文件在本浏览器内解析，不会上传到任何服务器
                  </p>
                  <PlatformGrid
                    onDirectFolder={handleDirectFolder}
                    onDirectFile={handleDirectFile}
                    onPlatformSelect={handlePlatformSelect}
                    selectedId={selected?.id ?? null}
                  />
                  <div
                    className={`import-panel__dropzone${dragActive ? ' import-panel__dropzone--active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      void pickFiles(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <span className="import-panel__dropzone-hint">
                      或者直接把 <strong>文件 / 文件夹 / ZIP 压缩包</strong> 拖到这里
                    </span>
                  </div>
                  {/* 图文教程入口：高亮卡片（含界面截图，新标签页打开） */}
                  <a
                    className="import-wz__tutorial"
                    href={TUTORIAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="import-wz__tutorial-badge" aria-hidden="true">
                      含界面截图
                    </span>
                    <span className="import-wz__tutorial-ico" aria-hidden="true">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" />
                        <path d="M22 4h-7a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" />
                      </svg>
                    </span>
                    <span className="import-wz__tutorial-text">
                      <span className="import-wz__tutorial-name">图文完整教程</span>
                      <span className="import-wz__tutorial-desc">
                        9 大平台导出方式速查 · 每一步都有界面截图 · 新标签页打开
                      </span>
                    </span>
                    <span className="import-wz__tutorial-go" aria-hidden="true">
                      查看 ↗
                    </span>
                  </a>
                </>
              )}

              {step === 'guide' && selected && !importing && (
                <PlatformGuideView
                  guide={selected}
                  onProceed={() => setStep('import')}
                  onBack={() => setStep('choose')}
                />
              )}

              {step === 'import' && !importing && (
                <>
                  <div
                    className={`import-panel__dropzone import-panel__dropzone--large${dragActive ? ' import-panel__dropzone--active' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      void pickFiles(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <svg
                      className="import-panel__dropzone-icon"
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
                      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                    </svg>
                    <span className="import-panel__dropzone-title">
                      {selected
                        ? `拖入${selected.name}导出的文件 / 目录 / ZIP 压缩包`
                        : '拖入已整理的文件夹 / 文件 / ZIP 压缩包'}
                    </span>
                    <span className="import-panel__dropzone-hint">
                      {selected
                        ? '目录 / 压缩包自动递归扫描，无需手动解压'
                        : '支持 .fit / .fit.gz / .gpx / .zip，文件夹自动递归扫描'}
                    </span>
                  </div>
                  <div className="import-wz__actions">
                    <button
                      type="button"
                      className="import-wz__btn import-wz__btn--primary"
                      onClick={() => void pickDirectory()}
                    >
                      选择目录
                    </button>
                    <button type="button" className="import-wz__btn" onClick={() => fileInputRef.current?.click()}>
                      选择文件
                    </button>
                  </div>
                  <p className="import-wz__note">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>
                      {selected
                        ? `已自动按「${selected.name}」来源解析：${selected.source === 'strava' ? '标题/描述按 activities.csv 还原' : selected.source === 'garmin' ? '标题按活动摘要 JSON 还原' : '标题按文件名还原'}，无需手动设置`
                        : DIRECT_SOURCE_NOTE}
                    </span>
                  </p>
                  <p className="import-wz__note import-wz__note--muted">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4m0 4h.01" />
                    </svg>
                    <span>{selected ? selected.formatNote : DIRECT_FORMAT_NOTE}</span>
                  </p>
                  <div className="import-panel__batch-source">
                    <label className="import-panel__batch-source-label" htmlFor="import-batch-source">
                      数据来自哪个 App？
                    </label>
                    <SourceSelect
                      label="本批文件来源 App"
                      value={batchSourceApp}
                      onChange={setBatchSourceApp}
                      autoOption="自动识别（按文件内容判断）"
                    />
                  </div>
                </>
              )}

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
                      发现 {summary.total} 个 FIT 文件，新增 {summary.newImported} 个， 已存在{' '}
                      {summary.skipped} 个，失败 {summary.failed} 个
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
          </div>
        </div>
      )}

      {/* 隐藏输入：文件选择与 webkitdirectory 目录回退 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".fit,.fit.gz,.gpx,.zip"
        className="import-panel__hidden-input"
        onChange={(event) => {
          // FileList 为 live 集合：先转数组保留 File 引用，再重置 value 供下次选择
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void pickFiles(files);
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
          // 同上：先转数组再重置，避免 live FileList 被清空
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) {
            void pickFiles(files);
          }
        }}
      />
    </div>
  );
}

export default ImportPanel;
