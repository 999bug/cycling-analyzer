/**
 * 逐点数据后台迁移（v4 activity_records 逐点行 → v5 activity_blobs 整活动行）。
 *
 * 设计原则：
 * - 升级事务（v5）只建空表，不搬数据——避免阻塞 db.open() 造成首屏卡 10~30s。
 *   数据由本模块在应用启动后的空闲时段分批搬运，每批让出主线程，UI 全程可交互。
 * - 幂等续传：以 activity_blobs 是否已有该活动行判断迁移与否，中断（关页面/
 *   崩溃）后重开页面自动续跑，无重复无遗漏。
 * - 多标签并发防护：settings 表写 running 心跳锁（15s 过期），后开标签自动让路。
 * - 与读取兜底双向收敛：getRecords 未命中新表时会回填，迁移任务重复处理时
 *   get 判存在即跳过，两边写入内容一致，last-write-wins 无害。
 * - 迁移完成后清空旧表数据（store 本体留待 v6 物理删除）并标记 done。
 */
import type { ActivityRecord } from '@/types/activity';
import type { ActivityRecordEntity, CyclingDatabase } from '@/storage/db';

/** 迁移状态在 settings 表的键 */
export const MIGRATION_SETTINGS_KEY = 'records-migration';

/** 迁移状态值 */
type MigrationStatus = 'pending' | 'running' | 'done';

/** 迁移状态实体（settings 表 value） */
interface MigrationState {
  status: MigrationStatus;

  /** 心跳时间（Unix 毫秒，running 锁的过期依据） */
  heartbeatAt: number;
}

/** 心跳锁过期时间（毫秒）：超时视为持有方已崩溃，允许其他标签接管 */
const HEARTBEAT_TTL_MS = 15_000;

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
 * 迁移进度回调载荷。
 */
export interface MigrationProgress {
  /** 已处理活动数（含跳过） */
  migrated: number;

  /** 活动总数 */
  total: number;
}

/**
 * 写入迁移状态。
 *
 * @param db 数据库实例
 * @param status 状态
 */
async function writeState(db: CyclingDatabase, status: MigrationStatus): Promise<void> {
  await db.settings.put({ key: MIGRATION_SETTINGS_KEY, value: { status, heartbeatAt: Date.now() } });
}

/** 抢锁结果 */
type LockResult =
  /** 抢到锁，本调用负责迁移 */
  | 'acquired'
  /** 此前会话已完成，调用方应静默跳过 */
  | 'already-done'
  /** 另一标签页持有有效锁，本调用应让路 */
  | 'busy';

/**
 * 以 CAS 方式抢占迁移锁。
 *
 * 检查与写入必须在**同一个读写事务**内完成：旧实现先 readState 再 writeState，
 * 两步之间另一标签同样能通过检查，两个标签会同时进入迁移（双写竞争，
 * 且旧表清理时机会互相踩踏）。IndexedDB 的读写事务保证这两步之间无其它事务插入。
 *
 * @param db 数据库实例
 * @returns 抢锁结果
 */
async function tryAcquireLock(db: CyclingDatabase): Promise<LockResult> {
  return db.transaction('rw', db.settings, async () => {
    const entry = await db.settings.get(MIGRATION_SETTINGS_KEY);
    const value = entry?.value as Partial<MigrationState> | undefined;
    const status = value?.status ?? 'pending';
    const heartbeatAt = value?.heartbeatAt ?? 0;
    if (status === 'done') {
      return 'already-done';
    }
    if (status === 'running' && Date.now() - heartbeatAt < HEARTBEAT_TTL_MS) {
      return 'busy';
    }
    // 接管过期锁（持有方崩溃）或从 pending 起跑
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() },
    });
    return 'acquired';
  });
}

/**
 * 刷新心跳（只能在调用方已开启的事务上下文中调用，会自动并入该事务）。
 *
 * @param db 数据库实例
 */
async function refreshHeartbeat(db: CyclingDatabase): Promise<void> {
  await db.settings.put({
    key: MIGRATION_SETTINGS_KEY,
    value: { status: 'running', heartbeatAt: Date.now() },
  });
}

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
  const lock = await tryAcquireLock(db);
  if (lock === 'already-done') {
    // 早已完成：返回 already-done 而非 done——否则每次启动都被误判为
    // 「本次刚完成」，横幅触发刷新造成无限刷新循环（2.47.0 线上事故）
    return 'already-done';
  }
  if (lock === 'busy') {
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
      // settings 一并纳入事务范围：心跳需随处理进度续期（见循环内 refreshHeartbeat）
      await db.transaction(
        'rw',
        [db.activities, db.activity_blobs, db.activity_records, db.settings],
        async () => {
          for (const activityId of batch) {
            // 心跳随处理进度续期：旧实现只在批间续期，单批耗时超过 TTL
            // （慢设备上一个大活动就可能）会被其它标签误判崩溃并接管
            await refreshHeartbeat(db);
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
      await db.settings.put({
        key: MIGRATION_SETTINGS_KEY,
        value: { status: 'done', heartbeatAt: Date.now() },
      });
    });
    return 'done';
  } catch (error: unknown) {
    // 释放锁：下次启动自动续跑（幂等，无副作用）
    await writeState(db, 'pending');
    throw error;
  }
}
