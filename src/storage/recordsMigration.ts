/**
 * 逐点数据后台迁移（v4 activity_records 逐点行 → v5 activity_blobs 整活动行）。
 *
 * 设计原则：
 * - 升级事务（v5）只建空表，不搬数据——避免阻塞 db.open() 造成首屏卡 10~30s。
 *   数据由本模块在应用启动后的空闲时段分批搬运，每批让出主线程，UI 全程可交互。
 * - 幂等续传：以 activity_blobs 是否已有该活动行判断迁移与否，中断（关页面/
 *   崩溃）后重开页面自动续跑，无重复无遗漏。
 * - 多标签并发防护：settings 表写 running 心跳锁（15s 过期），后开标签自动让路。
 *   锁的实现见 src/storage/migrationLock.ts（与 v9 分片迁移共用）。
 * - 与读取兜底双向收敛：getRecords 未命中新表时会回填，迁移任务重复处理时
 *   get 判存在即跳过，两边写入内容一致，last-write-wins 无害。
 * - 迁移完成后清空旧表数据（store 本体保留）并标记 done。
 *
 * 注意本层与 v9 的 chunksMigration 是**两层**迁移：本层产出 blobs，
 * chunksMigration 再把 blobs 换成分片。chunksMigration 会在本层处于 running
 * 时主动让路，避免「本层刚写好的 blob 立刻被下一层删掉、随后又被本层重建」的白工。
 */
import type { ActivityRecord } from '@/types/activity';
import type { ActivityRecordEntity, CyclingDatabase } from '@/storage/db';
import { createMigrationLock, type MigrationProgress } from '@/storage/migrationLock';

/** 迁移进度载荷（定义在 migrationLock，与 v9 分片迁移共用同一口径） */
export type { MigrationProgress };

/** 迁移状态在 settings 表的键 */
export const MIGRATION_SETTINGS_KEY = 'records-migration';

/** 每批迁移活动数：批间让出主线程，保证 UI 可交互 */
const BATCH_SIZE = 10;

/** 迁移结果 */
export type MigrationOutcome =
  /** 本次调用完成了全部迁移（含收尾清表），调用方据此提示完成并刷新 */
  | 'done'
  /** 迁移早已完成（此前会话已标记 done），调用方应静默跳过、不得触发刷新 */
  | 'already-done'
  /** 另一标签页正在迁移（本调用未做任何事） */
  | 'busy';

/**
 * 旧逐点行实体剥壳为领域记录（显式逐字段映射，与 activityRepository 同款口径）。
 *
 * @param entity 旧 activity_records 行
 */
function stripEntityToRecord(entity: ActivityRecordEntity): ActivityRecord {
  return {
    timestamp: entity.timestamp,
    latitude: entity.latitude,
    longitude: entity.longitude,
    altitude: entity.altitude,
    distance: entity.distance,
    speed: entity.speed,
    heartRate: entity.heartRate,
    cadence: entity.cadence,
    power: entity.power,
    temperature: entity.temperature,
  };
}

/**
 * 执行后台迁移：把旧 activity_records 逐点行聚合为 activity_blobs 整活动行。
 *
 * 幂等可重入，应用启动后调用一次即可；进度经 onProgress 上报（供横幅展示）。
 *
 * @param db 数据库实例
 * @param onProgress 进度回调（每批触发一次）
 * @returns 'done' 本次调用完成全部迁移；'already-done' 此前会话已完成（调用方应静默跳过）；'busy' 另一标签页正在迁移（本调用未做任何事）
 */
export async function runRecordsMigration(
  db: CyclingDatabase,
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationOutcome> {
  const lock = createMigrationLock(db, MIGRATION_SETTINGS_KEY);
  const acquired = await lock.tryAcquire();
  if (acquired === 'already-done') {
    // 早已完成：返回 already-done 而非 done——否则每次启动都被误判为
    // 「本次刚完成」，横幅触发刷新造成无限刷新循环（2.47.0 线上事故）
    return 'already-done';
  }
  if (acquired === 'busy') {
    // 另一标签页持有心跳锁：让路，避免双写竞争
    return 'busy';
  }

  try {
    const activityIds = (await db.activities.toCollection().primaryKeys()) as string[];
    const total = activityIds.length;
    let migrated = 0;

    for (let offset = 0; offset < activityIds.length; offset += BATCH_SIZE) {
      const batch = activityIds.slice(offset, offset + BATCH_SIZE);
      // 每批独立事务：批间让出主线程，且单批失败不拖垮已完成批次。
      // settings 一并纳入事务范围：心跳需随处理进度续期（见循环内 lock.refresh）
      await db.transaction(
        'rw',
        [db.activities, db.activity_blobs, db.activity_records, db.settings],
        async () => {
          for (const activityId of batch) {
            // 心跳随处理进度续期：只在批间续期时，单批耗时超过 TTL
            // （慢设备上一个大活动就可能）会被其它标签误判崩溃并接管
            await lock.refresh();
            // 防删除竞态：活动在迁移过程中被删则跳过（旧表行已随删除清理）
            if ((await db.activities.get(activityId)) === undefined) {
              migrated += 1;
              continue;
            }
            // 幂等：新表已有该活动行（前次迁移或读取兜底已回填）则跳过
            if ((await db.activity_blobs.get(activityId)) !== undefined) {
              migrated += 1;
              continue;
            }
            const legacy = await db.activity_records
              .where('activityId')
              .equals(activityId)
              .toArray();
            await db.activity_blobs.put({ activityId, records: legacy.map(stripEntityToRecord) });
            migrated += 1;
          }
        },
      );
      // 进度上报 + 让出主线程（setTimeout 0 落回事件循环）
      onProgress?.({ migrated, total });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // 全部完成：清旧表与标记 done 必须在**同一事务**内——
    // 旧实现分两步，中间失败会留下「旧表已清空、状态却没写成 done」的窗口：
    // 重跑时旧表已无数据可补，兜底读路径（getRecords 的旧表回填）也补不回来，
    // 结果是逐点数据永久丢失。
    await db.transaction('rw', [db.activity_records, db.settings], async () => {
      await db.activity_records.clear();
      await lock.markDone();
    });
    return 'done';
  } catch (error: unknown) {
    // 释放锁：下次启动自动续跑（幂等，无副作用）
    await lock.release();
    throw error;
  }
}
