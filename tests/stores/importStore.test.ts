/**
 * 导入 store 测试：导入完成后数据源自动切换。
 *
 * 访客在作者模式下导入自己的 FIT 文件后，自动切到「我的数据」
 * （导入只进本地库，不切源用户看不到刚导入的数据）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importFiles } from '@/features/import/importer'
import { useImportStore } from '@/stores/importStore'
import { useDataSourceStore } from '@/stores/dataSourceStore'

vi.mock('@/features/import/importer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/import/importer')>()
  return { ...original, importFiles: vi.fn() }
})

/** importFiles 的 mock 句柄 */
const mockImportFiles = vi.mocked(importFiles)

/** 构造导入汇总 */
function makeSummary(newImported: number) {
  return { total: 1, newImported, skipped: 0, failed: 0, failedItems: [] }
}

/** 构造导入文件（importFiles 已 mock，内容不参与断言） */
function makeFile(name = 'ride.fit') {
  return { path: name, name, file: new File([], name) }
}

describe('importStore 数据源自动切换', () => {
  beforeEach(() => {
    localStorage.clear()
    useImportStore.getState().reset()
    useDataSourceStore.setState({ source: 'author', authorAvailable: true, authorName: 'Saul' })
    mockImportFiles.mockReset()
  })

  it('有新导入活动时自动切到「我的数据」', async () => {
    mockImportFiles.mockResolvedValue(makeSummary(1))
    await useImportStore.getState().startImport([makeFile()], { saveOriginalFit: false })
    expect(useDataSourceStore.getState().source).toBe('local')
  })

  it('无新导入（全部重复）时保持当前数据源', async () => {
    mockImportFiles.mockResolvedValue(makeSummary(0))
    await useImportStore.getState().startImport([makeFile()], { saveOriginalFit: false })
    expect(useDataSourceStore.getState().source).toBe('author')
  })

  it('导入流程失败时不切换数据源', async () => {
    mockImportFiles.mockRejectedValue(new Error('parse failed'))
    await useImportStore.getState().startImport([makeFile()], { saveOriginalFit: false })
    expect(useDataSourceStore.getState().source).toBe('author')
  })
})
