/**
 * `activities.localDate` 一次性回填（v8 新增索引字段）。
 *
 * 背景：年/月筛选需要按**本地时区**的日期前缀匹配，而 `startTime` 是 UTC ISO
 * 字符串，二者在时区边界上不等价（UTC 23:30 可能是本地次日）。因此 v8 新增
 * `localDate` 索引字段，新写入的数据由 `toActivityEntity` 顺带填好，存量数据
 * 由本模块回填。
 *
 * 设计取舍：
 * - 不在 v8 升级事务里回填：升级事务内做全表异步重写会长时间阻塞 `db.open()`，
 *   首屏卡顿（v5 迁移已为此改成「升级只建表、应用启动后后台搬数据」）。
 * - 单次全表游标扫描 + 分批事务：以主键游标推进而非「反复筛选缺失行」，
 *   保证即使存在 `startTime` 非法（无法算出 localDate）的行也不会死循环。
 * - 落 `localDateIndexReady` 标志：只有全表走完才标记就绪，未就绪时列表查询
 *   自动回退全量路径——不做「索引一定在」的隐式假设。
 * - 幂等：重复调用只补缺失字段（已填过的行不重写），中断后下次启动重跑即可。
 */
import type { CyclingDatabase } from '@/storage/db';
import { localDateKeyFromIso } from '@/utils/format';

/** 就绪标志在 settings 表的键 */
export const LOCAL_DATE_READY_KEY = 'localDateIndexReady';

/** 每批回填活动数：批间让出主线程，保证 UI 可交互 */
const BATCH_SIZE = 200;

/**
 * 读取 localDate 索引是否已就绪。
 *
 * 未就绪时列表查询不得走 localDate 索引路径（会漏掉尚未回填的行）。
 *
 * @param db 数据库实例
 * @returns 是否就绪（无记录视为未就绪）
 */
export async function isLocalDateIndexReady(db: CyclingDatabase): Promise<boolean> {
  const entry = await db.settings.get(LOCAL_DATE_READY_KEY);
  return entry?.value === true;
}

/**
 * 回填全部缺失的 `localDate` 并标记就绪（幂等，可重复调用）。
 *
 * @param db 数据库实例
 * @returns 本次补齐的活动条数（已就绪时返回 0）
 */
export async function backfillLocalDates(db: CyclingDatabase): Promise<number> {
  if (await isLocalDateIndexReady(db)) {
    return 0;
  }

  let cursorId: string | undefined;
  let filled = 0;
  // 以主键游标单次遍历：每轮取 BATCH_SIZE 行推进游标，行数收敛即结束。
  // 不用 filter(missing).limit(n) 的写法——startTime 非法的行永远补不上，
  // 会被反复扫到，循环无法终止。
  for (;;) {
    const batch =
      cursorId === undefined
        ? await db.activities.orderBy(':id').limit(BATCH_SIZE).toArray()
        : await db.activities.where(':id').above(cursorId).limit(BATCH_SIZE).toArray();
    if (batch.length === 0) {
      break;
    }
    cursorId = batch[batch.length - 1].id;
    const pending = batch
      .filter((row) => row.localDate === undefined)
      .map((row) => ({ id: row.id, localDate: localDateKeyFromIso(row.startTime) }))
      .filter((row) => row.localDate !== undefined);
    if (pending.length > 0) {
      await db.transaction('rw', db.activities, async () => {
        for (const row of pending) {
          // 只补该字段，其余摘要不动（update 为局部更新）
          await db.activities.update(row.id, { localDate: row.localDate });
        }
      });
      filled += pending.length;
    }
    // 让出主线程：大批量回填不阻塞首屏交互
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await db.settings.put({ key: LOCAL_DATE_READY_KEY, value: true });
  return filled;
}
