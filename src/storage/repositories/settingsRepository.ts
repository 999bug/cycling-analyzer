/**
 * 设置仓库（settings 表，规格 §18）。
 *
 * 键值对存储，值可为任意可结构化克隆的数据（JSON 对象、数组、原始值）。
 */
import type { CyclingDatabase } from '@/storage/db';

/**
 * 设置仓库接口。
 */
export interface SettingsRepository {
  /**
   * 按键读取设置值。
   *
   * @param key 设置键
   * @returns 设置值，不存在时 undefined
   */
  get(key: string): Promise<unknown | undefined>;

  /**
   * 写入设置值（已存在时覆盖）。
   *
   * @param key 设置键
   * @param value 设置值
   */
  set(key: string, value: unknown): Promise<void>;

  /**
   * 删除设置项。
   *
   * @param key 设置键
   */
  delete(key: string): Promise<void>;
}

/**
 * Dexie 实现的设置仓库。
 */
export class DexieSettingsRepository implements SettingsRepository {
  private readonly db: CyclingDatabase;

  /**
   * @param db 数据库实例（测试可注入独立实例）
   */
  constructor(db: CyclingDatabase) {
    this.db = db;
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = await this.db.settings.get(key);
    return entry?.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  async delete(key: string): Promise<void> {
    await this.db.settings.delete(key);
  }
}
