/**
 * 骑行数据源扫描（规格 §6.1/§7）。
 *
 * 三个入口归一化为统一的 ScanResult：
 * - 目录选择：File System Access API（showDirectoryPicker）递归扫描；
 * - 传统目录选择：<input webkitdirectory multiple>（FileList 回退）；
 * - 拖拽：DataTransfer.files。
 *
 * 设计：文件名匹配为纯函数（可单测），目录遍历为浏览器适配层，
 * 扫描得到的文件统一携带相对路径（path），用于 Strava activities.csv
 * 按文件名还原活动标题（规格 §31）。
 */

/**
 * 扫描结果中的单个 FIT 文件。
 */
export interface ScannedFile {
  /** 相对路径（从所选根目录起，如 activities/xxx.fit.gz；无路径信息时等于文件名） */
  path: string

  /** 纯文件名（最后一段） */
  name: string

  /** 文件对象 */
  file: File
}

/**
 * 扫描结果。
 */
export interface ScanResult {
  /** 找到的 FIT 文件（*.fit / *.fit.gz） */
  files: ScannedFile[]

  /** 发现的 activities.csv（取第一个，用于标题还原），未找到时 undefined */
  csvFile?: File
}

/**
 * 判断文件名是否为 FIT 文件（.fit / .fit.gz，忽略大小写）。
 */
export function isFitFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.fit') || lower.endsWith('.fit.gz')
}

/**
 * 判断文件名是否为 Strava 元数据 CSV（activities.csv，忽略大小写）。
 */
export function isActivitiesCsvName(fileName: string): boolean {
  return fileName.toLowerCase() === 'activities.csv'
}

/**
 * 从文件集合中收集 FIT 文件与 activities.csv（拖拽与 FileList 共用）。
 * 文件路径取 webkitRelativePath（webkitdirectory 场景），否则回退为文件名。
 *
 * @param files 文件集合（FileList 或 File[]）
 */
export function collectFitFiles(files: Iterable<File>): ScanResult {
  const result: ScanResult = { files: [] }
  for (const file of files) {
    if (isActivitiesCsvName(file.name)) {
      result.csvFile ??= file
    } else if (isFitFileName(file.name)) {
      result.files.push({
        path: file.webkitRelativePath || file.name,
        name: file.name,
        file,
      })
    }
  }
  return result
}

/**
 * 传统目录选择的回退入口（<input webkitdirectory multiple>）。
 *
 * @param files 输入框选择的文件列表
 */
export function scanFilesLegacy(files: FileList): ScanResult {
  return collectFitFiles(Array.from(files))
}

/**
 * 递归扫描目录句柄（File System Access API）。
 * 任意层级收集 FIT 文件与 activities.csv（Strava 导出的 CSV 位于根目录）。
 *
 * @param dirHandle 目录句柄（showDirectoryPicker 获取）
 */
export async function scanDirectory(dirHandle: FileSystemDirectoryHandle): Promise<ScanResult> {
  const result: ScanResult = { files: [] }
  await scanDirHandle(dirHandle, '', result)
  return result
}

/**
 * 递归遍历目录，收集 FIT 文件并构造相对路径。
 *
 * @param dirHandle 当前目录句柄
 * @param prefix 当前目录的相对路径前缀（根目录为空串）
 * @param result 收集结果（原地累加）
 */
async function scanDirHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix: string,
  result: ScanResult,
): Promise<void> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      await scanDirHandle(handle as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name, result)
      continue
    }

    const fileHandle = handle as FileSystemFileHandle
    if (isActivitiesCsvName(name)) {
      result.csvFile ??= await fileHandle.getFile()
    } else if (isFitFileName(name)) {
      result.files.push({
        path: prefix ? `${prefix}/${name}` : name,
        name,
        file: await fileHandle.getFile(),
      })
    }
  }
}
