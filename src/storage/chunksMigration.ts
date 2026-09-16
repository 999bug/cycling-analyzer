/**
 * 逐点数据第二层后台迁移（v5 activity_blobs 整活动行 → v9 activity_chunks 分片）。
 *
 * 为什么需要单独一层：v5 的「每活动一行」解决了写入/删除的痛点，但读取是全有全无的。
 * 实测（`npm run bench:data-layer`）10 万点活动下，详情页只读 100 点仍要解出 15.4MB，
 * 按 1 万点/批导出会做 11 次整行反序列化（放大 11 倍）。分片把读取粒度降到 2000 点。
 *
 * 与 v5 那层的关系：本层消费 v5 的产物。为避免「本层刚删掉 blob、上一层又写回来」的
 * 白工，上一层的 settings 状态为 running 时本层直接让路（见 `DEFER` 分支）。
 *
 * 完成判据刻意**不用 `done` 标志位**，而是「blobs 表是否还有行」：
 * - `count()` 只读键，不解 value，启动开销可忽略；
 * - 标志位会漏掉「上一层晚到、又写了一份 blob」的自愈场景，而按行数判断天然幂等。
 *
 * 原子性：每个活动「写全部分片 + 删源行」在同一事务内完成。因此中断（关页面/崩溃）
 * 后要么该活动已完成、要么源行仍在，不存在「两边都不完整」的窗口，重开页面自动续跑。
 */
import type { ActivityChunkEntity, CyclingDatabase } from '@/storage/db';
import { toChunkEntities } from '@/storage/activityChunks';
import { createMigrationLock, type MigrationProgress } from '@/storage/migrationLock';
import { MIGRATION_SETTINGS_KEY as RECORDS_MIGRATION_SETTINGS_KEY } from '@/storage/recordsMigration';

/** 本层迁移状态在 settings 表的键（抢占互斥锁用） */
export const CHUNKS_MIGRATION_SETTINGS_KEY = 'chunks-migration';

/** 每批处理活动数：单个活动的分片写入可能较大，批比上一层更小以保证事务时长可控 */
const BATCH_SIZE = 5;

/** 心跳锁过期时间（毫秒）：判断上一层是否仍在迁移时复用同一口径 */
const HEARTBEAT_TTL_MS = 15_000;

/** 迁移结果 */
export type ChunksMigrationOutcome =
  /** 本次调用完成了全部搬迁 */
  | 'done'
  /** 没有待搬迁数据（blobs 表已空），或早已完成 */
  | 'already-done'
  /** 另一标签页正在做本层迁移（本调用未做任何事） */
  | 'busy'
  /** 上一层（v4 逐点行 → v5 整活动行）仍在迁移，本层让路，下次启动再跑 */
  | 'deferred';

/**
 * 执行第二层后台迁移：把 activity_blobs 整活动行换分为 activity_chunks 分片。
 *
 * 幂等可重入，应用启动后调用一次即可；结果不含用户可见语义（读取路径同时兼容
 * 两种布局），因此**不需要**横幅提示，也不应在完成后刷新页面。
 *
 * @param db 数据库实例
 * @param onProgress 进度回调（每批触发一次）
 * @returns 迁移结果
 */
export async function runChunksMigration(
  db: CyclingDatabase,
  onProgress?: (progress: MigrationProgress) => void,
): Promise<ChunksMigrationOutcome> {
  // 上一层仍在跑：本层会把它的产物（blob）搬走并删除，而它随后会认为
  // 「该活动还没有 blob」又写回一份 —— 白工，且留下永远清不掉的遗留行
  const legacy = createMigrationLock(db, RECORDS_MIGRATION_SETTINGS_KEY);
  const legacyState = await legacy.readState();
  if (
    legacyState.status === 'running' &&
    Date.now() - legacyState.heartbeatAt < HEARTBEAT_TTL_MS
  ) {
    return 'deferred';
  }

  // blobs 表为空 = 没有待搬迁数据。用行数而非标志位：见文件头说明
  if ((await db.activity_blobs.count()) === 0) {
    return 'already-done';
  }

  const lock = createMigrationLock(db, CHUNKS_MIGRATION_SETTINGS_KEY);
  const acquired = await lock.tryAcquire();
  if (acquired === 'already-done') {
    return 'already-done';
  }
  if (acquired === 'busy') {
    // 另一标签页正在做本层迁移：让路，它做完后 blobs 即为空
    return 'busy';
  }

  try {
    // 待搬迁清单 = blobs 表主键（就是 activityId）。键级操作，不解出任何 records
    const activityIds = (await db.activity_blobs.toCollection().primaryKeys()) as string[];
    const total = activityIds.length;
    let migrated = 0;

    for (let offset = 0; offset < activityIds.length; offset += BATCH_SIZE) {
      const batch = activityIds.slice(offset, offset + BATCH_SIZE);
      // settings 纳入事务范围：心跳需随处理进度续期
      await db.transaction(
        'rw',
        [db.activities, db.activity_chunks, db.activity_blobs, db.settings],
        async () => {
          for (const activityId of batch) {
            // 心跳随处理进度续期：单个大活动的分片写入就可能超过 TTL
            await lock.refresh();
            const blob = await db.activity_blobs.get(activityId);
            if (blob === undefined) {
              // 已被其它路径搬走（读取兜底 / 并发迁移）
              migrated += 1;
              continue;
            }
            // 防删除竞态：活动行已不在（blob 由旧版本遗留、未随删除级联清理），
            // 直接丢弃源行，不写孤儿分片
            if ((await db.activities.get(activityId)) === undefined) {
              await db.activity_blobs.delete(activityId);
              migrated += 1;
              continue;
            }
            const chunks: ActivityChunkEntity[] = toChunkEntities(activityId, blob.records);
            if (chunks.length > 0) {
              await db.activity_chunks.bulkPut(chunks);
            }
            // 与写入同事务地删源行：这是本层原子性的全部依据
            await db.activity_blobs.delete(activityId);
            migrated += 1;
          }
        },
      );
      onProgress?.({ migrated, total });
      // 让出主线程：大批量数据的搬迁不应阻塞首屏交互
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return 'done';
  } finally {
    // 成败都释放锁（本层不用 done 标志位，下一次调用靠 blobs 行数判定）。
    // 失败时释放尤为必要：否则锁要等 TTL 过期才能被接管。释放失败不掩盖原错误
    await lock.release().catch(() => {});
  }
}
