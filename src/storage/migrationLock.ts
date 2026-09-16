/**
 * IndexedDB 迁移的单写者锁（CAS 抢锁 + 心跳续期 + 完成标记）。
 *
 * v5（`recordsMigration`：逐点行 → 整活动行）与 v9（`chunksMigration`：
 * 整活动行 → 分片）两层迁移共用本模块。抽出来的理由不是复用代码，而是
 * 这套并发语义**写错一次就丢数据**，两处必须严格一致：
 *
 * - **检查与写入必须在同一个读写事务内完成**。先 `get` 再 `put` 两步之间，
 *   另一标签同样能通过检查，于是两个标签同时进入迁移：双写竞争之外，
 *   清表/删源的时机也会互相踩踏。IndexedDB 的读写事务保证这两步之间
 *   不会被其它事务插入。
 * - **迁移方必须随处理进度续期心跳**，不能只在批间续期。慢设备上单个大活动
 *   的处理就可能超过 TTL，另一标签会把它误判成「持有方已崩溃」而接管。
 * - **完成后写 done，但调用方必须把 done 与「本次刚完成」区分开**。
 *   每次启动都把 done 当成刚完成，完成横幅就会触发刷新，形成无限刷新循环
 *   （2.47.0 线上事故）。
 *
 * `refresh()` 与 `markDone()` 是**普通 put**：Dexie 会自动并入调用方当前
 * 所处的事务，所以调用方可以把「清源表/删源行」与「标记完成」放进同一事务
 * （这是原子性的关键，见 `chunksMigration` 与 `recordsMigration` 的收尾）。
 */
import type { CyclingDatabase } from '@/storage/db';

/** 迁移状态 */
export type MigrationStatus = 'pending' | 'running' | 'done';

/** 迁移状态实体（settings 表 value） */
export interface MigrationState {
  status: MigrationStatus;

  /** 心跳时间（Unix 毫秒，running 锁的过期依据） */
  heartbeatAt: number;
}

/** 抢锁结果 */
export type MigrationLockOutcome =
  /** 抢到锁，本调用负责迁移 */
  | 'acquired'
  /** 此前会话已完成，调用方应静默跳过（**不得**当作本次刚完成） */
  | 'already-done'
  /** 另一标签页持有有效锁，本调用应让路 */
  | 'busy';

/**
 * 迁移进度回调载荷（两层迁移共用：每批触发一次）。
 */
export interface MigrationProgress {
  /** 已处理单位数（活动数，含跳过） */
  migrated: number;

  /** 单位总数 */
  total: number;
}

/**
 * 迁移锁句柄。
 */
export interface MigrationLock {
  /** 以 CAS 方式抢占锁 */
  tryAcquire(): Promise<MigrationLockOutcome>;

  /** 只读当前状态（供另一层迁移判断是否该让路） */
  readState(): Promise<MigrationState>;

  /** 续期心跳（调用方应在已开启的事务内、每个处理单位前调用一次） */
  refresh(): Promise<void>;

  /** 标记完成（调用方应在已开启的事务内调用，与源数据清理同事务） */
  markDone(): Promise<void>;

  /** 放弃锁（失败后释放，下次启动自动续跑） */
  release(): Promise<void>;
}

/** 心跳锁过期时间（毫秒）：超时视为持有方已崩溃，允许其他标签接管 */
const DEFAULT_HEARTBEAT_TTL_MS = 15_000;

/**
 * 创建迁移锁。
 *
 * @param db 数据库实例
 * @param settingsKey 该层迁移在 settings 表的键（两层迁移各自独立加锁）
 * @param heartbeatTtlMs 心跳锁过期时间（毫秒，测试可注入）
 * @returns 迁移锁句柄
 */
export function createMigrationLock(
  db: CyclingDatabase,
  settingsKey: string,
  heartbeatTtlMs: number = DEFAULT_HEARTBEAT_TTL_MS,
): MigrationLock {
  async function readState(): Promise<MigrationState> {
    const entry = await db.settings.get(settingsKey);
    const value = entry?.value as Partial<MigrationState> | undefined;
    return {
      status: value?.status ?? 'pending',
      heartbeatAt: value?.heartbeatAt ?? 0,
    };
  }

  async function write(status: MigrationStatus): Promise<void> {
    await db.settings.put({ key: settingsKey, value: { status, heartbeatAt: Date.now() } });
  }

  return {
    readState,

    async tryAcquire(): Promise<MigrationLockOutcome> {
      return db.transaction('rw', db.settings, async (): Promise<MigrationLockOutcome> => {
        const state = await readState();
        if (state.status === 'done') {
          return 'already-done';
        }
        if (state.status === 'running' && Date.now() - state.heartbeatAt < heartbeatTtlMs) {
          return 'busy';
        }
        // 接管过期锁（持有方崩溃）或从 pending 起跑
        await write('running');
        return 'acquired';
      });
    },

    refresh: () => write('running'),
    markDone: () => write('done'),
    release: () => write('pending'),
  };
}
