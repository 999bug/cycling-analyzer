/**
 * 数据源扫描测试：文件名规则、FileList/拖拽归一化、目录句柄递归扫描与相对路径。
 */
import { describe, expect, it } from 'vitest'
import {
  collectFitFiles,
  isActivitiesCsvName,
  isFitFileName,
  scanDirectory,
  scanFilesLegacy,
} from '@/features/import/scanner'

/**
 * 构造测试 File。
 *
 * @param name 文件名
 * @param content 内容（默认 'x'）
 */
function makeFile(name: string, content = 'x'): File {
  return new File([content], name)
}

/**
 * 构造文件句柄 mock（仅实现 scanDirectory 依赖的形状）。
 *
 * @param file 对应文件
 */
function makeFileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    getFile: async () => file,
  } as unknown as FileSystemFileHandle
}

/**
 * 构造目录句柄 mock。
 *
 * @param children 子项（文件句柄或目录句柄）
 */
function makeDirHandle(children: Record<string, unknown>): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    entries: async function* () {
      for (const [name, handle] of Object.entries(children)) {
        yield [name, handle] as [string, FileSystemHandle]
      }
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('文件名规则', () => {
  it('识别 .fit 与 .fit.gz（不区分大小写）', () => {
    expect(isFitFileName('ride.fit')).toBe(true)
    expect(isFitFileName('ride.fit.gz')).toBe(true)
    expect(isFitFileName('RIDE.FIT.GZ')).toBe(true)
  })

  it('拒绝其他文件与相似扩展名', () => {
    expect(isFitFileName('route.gpx')).toBe(false)
    expect(isFitFileName('ride.fitb')).toBe(false)
    expect(isFitFileName('activities.csv')).toBe(false)
  })

  it('识别 activities.csv（不区分大小写）', () => {
    expect(isActivitiesCsvName('activities.csv')).toBe(true)
    expect(isActivitiesCsvName('ACTIVITIES.CSV')).toBe(true)
    expect(isActivitiesCsvName('activities.csv.bak')).toBe(false)
  })
})

describe('collectFitFiles / scanFilesLegacy', () => {
  it('从文件集合中过滤 FIT 文件并提取 csv（拖拽场景）', () => {
    const csv = makeFile('activities.csv', '活动 ID,活动名称,文件名')
    const result = collectFitFiles([makeFile('README.txt'), makeFile('a.fit'), csv, makeFile('b.fit.gz')])

    expect(result.files.map((f) => f.name)).toEqual(['a.fit', 'b.fit.gz'])
    expect(result.csvFile?.name).toBe('activities.csv')
    // 无路径信息时 path 回退为文件名
    expect(result.files[0].path).toBe('a.fit')
  })

  it('扫描空集合返回空结果', () => {
    const result = collectFitFiles([])

    expect(result.files).toEqual([])
    expect(result.csvFile).toBeUndefined()
  })

  it('webkitdirectory 输入保留相对路径', () => {
    const file = makeFile('ride-1.fit.gz')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'activities/ride-1.fit.gz' })

    const fileList = {
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
      [Symbol.iterator]: function* () {
        yield file
      },
    } as unknown as FileList
    const result = scanFilesLegacy(fileList)

    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('activities/ride-1.fit.gz')
    expect(result.files[0].name).toBe('ride-1.fit.gz')
  })
})

describe('scanDirectory 目录扫描', () => {
  it('递归收集 FIT 文件并构造相对路径（Strava 导出结构）', async () => {
    const activitiesDir = makeDirHandle({
      'ride-1.fit.gz': makeFileHandle(makeFile('ride-1.fit.gz')),
      'ride-2.fit': makeFileHandle(makeFile('ride-2.fit')),
      'heart-rate.fit.gz': makeFileHandle(makeFile('heart-rate.fit.gz')),
    })
    const root = makeDirHandle({
      activities: activitiesDir,
      'activities.csv': makeFileHandle(makeFile('activities.csv', 'csv content')),
      'README.txt': makeFileHandle(makeFile('README.txt')),
    })

    const result = await scanDirectory(root)

    expect(result.files.map((f) => f.path)).toEqual([
      'activities/ride-1.fit.gz',
      'activities/ride-2.fit',
      'activities/heart-rate.fit.gz',
    ])
    expect(result.files[0].name).toBe('ride-1.fit.gz')
    expect(result.csvFile).toBeDefined()
  })

  it('无 csv 时 csvFile 为 undefined', async () => {
    const root = makeDirHandle({ 'a.fit': makeFileHandle(makeFile('a.fit')) })

    const result = await scanDirectory(root)

    expect(result.files).toHaveLength(1)
    expect(result.csvFile).toBeUndefined()
  })

  it('多级嵌套目录路径正确拼接', async () => {
    const deep = makeDirHandle({ 'deep.fit': makeFileHandle(makeFile('deep.fit')) })
    const mid = makeDirHandle({ nested: deep })
    const root = makeDirHandle({ outer: mid })

    const result = await scanDirectory(root)

    expect(result.files[0].path).toBe('outer/nested/deep.fit')
  })

  it('忽略非 FIT 文件', async () => {
    const root = makeDirHandle({
      'a.fit': makeFileHandle(makeFile('a.fit')),
      'b.gpx': makeFileHandle(makeFile('b.gpx')),
      'notes.txt': makeFileHandle(makeFile('notes.txt')),
    })

    const result = await scanDirectory(root)

    expect(result.files.map((f) => f.name)).toEqual(['a.fit'])
  })
})
