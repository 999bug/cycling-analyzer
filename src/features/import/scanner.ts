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
 *
 * zip 支持（佳明批量导入适配）：扫描层将 .zip 收入 archives（不解压），
 * 由 expandArchives 异步展开（fflate，深度限 2 层）——佳明 GDPR 全量导出包
 * 的 FIT 封装在内层 UploadedFiles_*.zip 中，同时收集其活动摘要 JSON 供标题还原。
 */
import { unzip, type Unzipped } from 'fflate';
import { isGarminSummariesName } from './garminExport';

/**
 * 扫描结果中的单个 FIT 文件。
 */
export interface ScannedFile {
  /** 相对路径（从所选根目录起，如 activities/xxx.fit.gz；无路径信息时等于文件名） */
  path: string;

  /** 纯文件名（最后一段） */
  name: string;

  /** 文件对象 */
  file: File;
}

/**
 * 扫描结果。
 */
export interface ScanResult {
  /** 找到的活动文件（*.fit / *.fit.gz / *.gpx / *.gpx.gz） */
  files: ScannedFile[];

  /** 发现的 activities.csv（取第一个，用于标题还原），未找到时 undefined */
  csvFile?: File;

  /** 发现的 zip 压缩包（含佳明 GDPR 内层 zip），导入前经 expandArchives 展开 */
  archives: ScannedFile[];

  /** 发现的佳明 GDPR 活动摘要 JSON（取第一个，用于标题还原），未找到时 undefined */
  garminJson?: File;

  /** 展开压缩包等非致命警告（如单个 zip 解压失败），UI 以提示展示 */
  warnings: string[];
}

/**
 * 判断文件名是否为 FIT 文件（.fit / .fit.gz，忽略大小写）。
 */
export function isFitFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.fit') || lower.endsWith('.fit.gz');
}

/**
 * 判断文件名是否为 GPX 文件（.gpx / .gpx.gz，忽略大小写）。
 */
export function isGpxFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.gpx') || lower.endsWith('.gpx.gz');
}

/**
 * 判断文件名是否为可导入的活动文件（FIT 或 GPX，忽略大小写）。
 */
export function isActivityFileName(fileName: string): boolean {
  return isFitFileName(fileName) || isGpxFileName(fileName);
}

/**
 * 判断文件名是否为 Strava 元数据 CSV（activities.csv，忽略大小写）。
 */
export function isActivitiesCsvName(fileName: string): boolean {
  return fileName.toLowerCase() === 'activities.csv';
}

/**
 * 判断文件名是否为 zip 压缩包（.zip，忽略大小写）。
 */
export function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.zip');
}

/**
 * zip 展开的最大深度：佳明 GDPR 包为「外层目录 → 内层 UploadedFiles zip → FIT」
 * 两层嵌套，深度 2 覆盖；超出深度不再展开。
 */
const ARCHIVE_MAX_DEPTH = 2;

/**
 * 单个 zip 解压的条目数上限（防异常包拖垮内存）。
 */
const ARCHIVE_MAX_ENTRIES = 5000;

/**
 * 单个 zip 解压后的字节总量上限（512MB，防 zip 炸弹）。
 */
const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;

/**
 * 将单个文件按类型归入扫描结果（同步分拣，zip 不解压只登记）。
 *
 * @param path 相对路径
 * @param name 纯文件名
 * @param file 文件对象
 * @param result 收集结果（原地累加）
 */
function classifyEntry(path: string, name: string, file: File, result: ScanResult): void {
  if (isActivitiesCsvName(name)) {
    result.csvFile ??= file;
  } else if (isGarminSummariesName(name)) {
    result.garminJson ??= file;
  } else if (isZipFileName(name)) {
    result.archives.push({ path, name, file });
  } else if (isActivityFileName(name)) {
    result.files.push({ path, name, file });
  }
}

/**
 * 构造空扫描结果（UI 手拼单文件结果等场景，避免漏新增字段）。
 */
export function emptyScanResult(): ScanResult {
  return { files: [], archives: [], warnings: [] };
}

/**
 * 从文件集合中收集活动文件、压缩包与元数据文件（拖拽与 FileList 共用）。
 * 文件路径取 webkitRelativePath（webkitdirectory 场景），否则回退为文件名。
 * zip 不在此处展开（同步函数），由调用方经 expandArchives 异步展开。
 *
 * @param files 文件集合（FileList 或 File[]）
 */
export function collectFitFiles(files: Iterable<File>): ScanResult {
  const result: ScanResult = { files: [], archives: [], warnings: [] };
  for (const file of files) {
    classifyEntry(file.webkitRelativePath || file.name, file.name, file, result);
  }
  return result;
}

/**
 * 传统目录选择的回退入口（<input webkitdirectory multiple>）。
 *
 * @param files 输入框选择的文件列表
 */
export function scanFilesLegacy(files: FileList): ScanResult {
  return collectFitFiles(Array.from(files));
}

/**
 * 递归扫描目录句柄（File System Access API）。
 * 任意层级收集活动文件、zip 压缩包与元数据文件（Strava 导出的 CSV 位于根目录）。
 *
 * @param dirHandle 目录句柄（showDirectoryPicker 获取）
 */
export async function scanDirectory(dirHandle: FileSystemDirectoryHandle): Promise<ScanResult> {
  const result: ScanResult = { files: [], archives: [], warnings: [] };
  await scanDirHandle(dirHandle, '', result);
  return result;
}

/**
 * 递归遍历目录，收集活动文件并构造相对路径。
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
      await scanDirHandle(
        handle as FileSystemDirectoryHandle,
        prefix ? `${prefix}/${name}` : name,
        result,
      );
      continue;
    }

    const fileHandle = handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    classifyEntry(prefix ? `${prefix}/${name}` : name, name, file, result);
  }
}

/**
 * 展开扫描结果中的 zip 压缩包（原地修改 result）。
 *
 * 逐层展开（每层消耗 1 深度）：展开产物中 FIT/GPX 归入 files、activities.csv
 * 与佳明摘要 JSON 归入对应字段、嵌套 zip 继续待展开直至深度耗尽。
 * 单个 zip 解压失败仅记录警告，不阻断其余文件。
 *
 * @param result 扫描结果（archives 中的 zip 被取出展开）
 * @param options.depth 最大展开层数（默认 ARCHIVE_MAX_DEPTH）
 */
export async function expandArchives(
  result: ScanResult,
  options: { depth?: number } = {},
): Promise<void> {
  let pending = result.archives.splice(0);
  let depth = options.depth ?? ARCHIVE_MAX_DEPTH;
  while (pending.length > 0 && depth > 0) {
    for (const archive of pending) {
      try {
        for (const entry of await unzipToFiles(archive)) {
          classifyEntry(entry.path, entry.name, entry.file, result);
        }
      } catch {
        result.warnings.push(`压缩包解压失败，已跳过：${archive.path}`);
      }
    }
    depth--;
    // 深度耗尽时不再取出下一层，未展开的嵌套 zip 保留在 archives 中
    pending = depth > 0 ? result.archives.splice(0) : [];
  }
}

/**
 * 解压单个 zip 为文件列表（fflate 异步版，worker 中执行不卡主线程）。
 * 产物路径 = zip 路径 + zip 内条目路径；超出条目数/字节上限抛错（外层记警告）。
 *
 * @param archive 待解压 zip
 */
async function unzipToFiles(archive: ScannedFile): Promise<ScannedFile[]> {
  const bytes = new Uint8Array(await archive.file.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (error, data) => (error ? reject(error) : resolve(data)));
  });
  const names = Object.keys(entries);
  if (names.length > ARCHIVE_MAX_ENTRIES) {
    throw new Error(`zip entries ${names.length} exceed limit`);
  }
  const out: ScannedFile[] = [];
  let totalBytes = 0;
  for (const entryPath of names) {
    const data = entries[entryPath];
    if (entryPath.endsWith('/') || data === undefined) {
      continue; // 目录条目
    }
    totalBytes += data.byteLength;
    if (totalBytes > ARCHIVE_MAX_BYTES) {
      throw new Error(`zip uncompressed size exceeds ${ARCHIVE_MAX_BYTES} bytes`);
    }
    const name = entryPath.slice(entryPath.lastIndexOf('/') + 1);
    if (name === '') {
      continue;
    }
    out.push({
      path: `${archive.path}/${entryPath}`,
      name,
      file: new File([data], name),
    });
  }
  return out;
}
