/**
 * 清空全部本地数据（规格 §32）。
 *
 * 清空范围：activities（含逐点 records）、files 台账、settings 设置。
 * 页面层负责二次确认，本模块只执行清空。
 */
import type { CyclingDatabase } from '@/storage/db'
import { db } from '@/storage/db'
import { DexieActivityRepository, type ActivityRepository } from '@/storage/repositories/activityRepository'
import { DexieFileRepository, type FileRepository } from '@/storage/repositories/fileRepository'

/** 默认活动仓库（全局数据库单例） */
const defaultActivityRepository = new DexieActivityRepository(db)

/** 默认文件台账仓库（全局数据库单例） */
const defaultFileRepository = new DexieFileRepository(db)

/** 清空选项 */
export interface ClearAllOptions {
  /** 数据库实例（settings 表清空用；测试注入独立实例） */
  db?: CyclingDatabase

  /** 活动仓库（测试注入独立实例） */
  activityRepository?: ActivityRepository

  /** 文件台账仓库（测试注入独立实例） */
  fileRepository?: FileRepository
}

/**
 * 清空全部本地数据：活动摘要、逐点记录、文件台账、设置。
 *
 * @param options 清空选项
 */
export async function clearAllData(options: ClearAllOptions = {}): Promise<void> {
  const {
    db: dbInstance = db,
    activityRepository = defaultActivityRepository,
    fileRepository = defaultFileRepository,
  } = options

  await activityRepository.deleteAll()
  await fileRepository.deleteAll()
  // settings 表：仓库接口未提供清空方法，直接清表
  await dbInstance.settings.clear()
}
