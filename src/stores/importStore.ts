/**
 * 导入状态 store（zustand，规格 §22 进度 UI）。
 *
 * 与页面解耦：UI 组件（ImportPanel）只订阅本 store，
 * 导入执行逻辑在 features/import/importer 中，store 仅编排状态。
 */
import { create } from 'zustand'
import { importFiles, type FailedItem, type ImportFile, type ImportOptions, type ImportSummary } from '@/features/import/importer'
import { getSettings } from '@/features/settings/settings'
import { useDataSourceStore } from '@/stores/dataSourceStore'

/**
 * 导入进度。
 */
export interface ImportProgress {
  /** 已处理文件数（从 1 开始） */
  current: number

  /** 本次导入文件总数 */
  total: number
}

/**
 * 导入 store 状态与 actions。
 */
export interface ImportStoreState {
  /** 是否正在导入 */
  importing: boolean

  /** 进度（未导入时为 0/0） */
  progress: ImportProgress

  /** 最近一次导入的汇总（未导入或已重置时为 null） */
  summary: ImportSummary | null

  /** 非文件级错误（如导入流程整体失败） */
  errors: string[]

  /** 上次导入中失败的文件（重试失败文件用，规格 §21） */
  lastFailedFiles: ImportFile[]

  /**
   * 开始导入。
   *
   * @param files 待导入文件
   * @param options 导入选项（parser/仓库等）
   * @returns 导入汇总；流程级失败返回 null
   */
  startImport(files: ImportFile[], options?: ImportOptions): Promise<ImportSummary | null>

  /**
   * 重试上次导入失败的文件。
   *
   * @returns 重试汇总；无失败文件时返回 null
   */
  retryFailed(): Promise<ImportSummary | null>

  /** 重置导入状态（进度/汇总/错误/失败缓存）。 */
  reset(): void
}

/**
 * 导入 store 实例。
 */
export const useImportStore = create<ImportStoreState>()((set, get) => ({
  importing: false,
  progress: { current: 0, total: 0 },
  summary: null,
  errors: [],
  lastFailedFiles: [],

  startImport: async (files, options) => {
    set({
      importing: true,
      errors: [],
      summary: null,
      progress: { current: 0, total: files.length },
    })
    try {
      // 读取「保存原始 FIT 文件」偏好（规格 §19）：options 显式传入时优先（测试注入）
      let saveOriginalFit = options?.saveOriginalFit
      if (saveOriginalFit === undefined) {
        const settings = await getSettings()
        saveOriginalFit = settings.import.saveOriginalFit
      }
      const summary = await importFiles(files, {
        ...options,
        saveOriginalFit,
        onProgress: (current, total) => set({ progress: { current, total } }),
      })
      set({
        summary,
        lastFailedFiles: files.filter((entry) =>
          summary.failedItems.some((item: FailedItem) => item.fileName === entry.name),
        ),
      })
      // 导入进本地库后自动切到「我的数据」：访客导入即见其数据
      if (summary.newImported > 0) {
        useDataSourceStore.getState().setSource('local')
      }
      return summary
    } catch (error) {
      set({ errors: [error instanceof Error ? error.message : String(error)] })
      return null
    } finally {
      set({ importing: false })
    }
  },

  retryFailed: async () => {
    const { lastFailedFiles } = get()
    if (lastFailedFiles.length === 0) {
      return null
    }
    return get().startImport(lastFailedFiles)
  },

  reset: () => {
    set({
      importing: false,
      progress: { current: 0, total: 0 },
      summary: null,
      errors: [],
      lastFailedFiles: [],
    })
  },
}))
