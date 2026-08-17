/**
 * 导入文件台账仓库（files 表，规格 §18）。
 *
 * 记录每个文件的导入状态：成功（imported）、失败（failed，含原因）、
 * 跳过（skipped，重复导入）。主键为文件内容指纹（SHA-256）。
 */
import type { FileEntity, CyclingDatabase } from '@/storage/db';

/**
 * 文件台账仓库接口。
 */
export interface FileRepository {
  /**
   * 记录一次成功导入。
   * 同一 fingerprint 重复调用时覆盖原记录（重新导入会更新台账）。
   *
   * @param fingerprint 文件 SHA-256 指纹
   * @param fileName 源文件名
   * @param fileSize 文件大小（字节）
   */
  recordImported(fingerprint: string, fileName: string, fileSize: number): Promise<void>;

  /**
   * 记录一次失败导入（文件大小未知时记为 0）。
   *
   * @param fingerprint 文件 SHA-256 指纹
   * @param fileName 源文件名
   * @param errorMessage 失败原因
   */
  recordFailed(fingerprint: string, fileName: string, errorMessage: string): Promise<void>;

  /**
   * 返回全部台账记录（按存储序；如需按时间排序，调用方自行排序或后续加索引）。
   */
  listAll(): Promise<FileEntity[]>;

  /**
   * 按指纹查询台账记录。
   *
   * @param fingerprint 文件 SHA-256 指纹
   */
  get(fingerprint: string): Promise<FileEntity | undefined>;

  /**
   * 清空台账（不涉及 activities/settings）。
   */
  deleteAll(): Promise<void>;
}

/**
 * Dexie 实现的文件台账仓库。
 */
export class DexieFileRepository implements FileRepository {
  private readonly db: CyclingDatabase;

  /**
   * @param db 数据库实例（测试可注入独立实例）
   */
  constructor(db: CyclingDatabase) {
    this.db = db;
  }

  async recordImported(fingerprint: string, fileName: string, fileSize: number): Promise<void> {
    await this.db.files.put({
      fingerprint,
      fileName,
      fileSize,
      importedAt: new Date().toISOString(),
      status: 'imported',
    });
  }

  async recordFailed(fingerprint: string, fileName: string, errorMessage: string): Promise<void> {
    await this.db.files.put({
      fingerprint,
      fileName,
      fileSize: 0,
      importedAt: new Date().toISOString(),
      status: 'failed',
      errorMessage,
    });
  }

  async listAll(): Promise<FileEntity[]> {
    return this.db.files.toArray();
  }

  async get(fingerprint: string): Promise<FileEntity | undefined> {
    return this.db.files.get(fingerprint);
  }

  async deleteAll(): Promise<void> {
    await this.db.files.clear();
  }
}
