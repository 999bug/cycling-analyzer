/**
 * 逐点数据分片的纯逻辑（v9 activity_chunks）。
 *
 * 抽成独立模块的理由：分片边界与区间换算是**纯算术**，出错的表现是「读取静默
 * 少点/错位」，靠端到端测试很难定位；放在这里可以用单测把边界钉死
 * （见 tests/storage/activityChunks.test.ts）。
 *
 * 分片布局：第 n 片持有 `[n*SIZE, (n+1)*SIZE)` 区间的记录，片内数组序 =
 * 原存储序 = 时间序。活动有多少点就写多少片，片数由 `ceil(总点数 / SIZE)` 决定。
 */
import type { ActivityRecord } from '@/types/activity';
import type { ActivityChunkEntity } from '@/storage/db';

/**
 * 每片逐点记录数。
 *
 * 定 2000 的依据（`npm run bench:data-layer`，10 万点活动）：
 * 导出按 1 万点/批读取时，片越大跨片浪费越多（5000 点时累计解出 2.4MB，
 * 2000 点时为 1.9MB，已接近理论下界）；而详情页只读 100 点时，2000 点片
 * 解出 0.32MB，比 5000 点片的 0.8MB 少一半以上。典型活动 3600~10800 点
 * 恰好是 2~6 片，片数增加带来的写放大有限。
 */
export const ACTIVITY_CHUNK_SIZE = 2000;

/**
 * 把逐点记录切分为分片实体（纯函数）。
 *
 * 记录为空时返回空数组——调用方据此跳过写入：写 0 片与不写等价，
 * 而读取路径对「无任何片」的活动会依次回退到 blobs / 旧逐点行表，
 * 语义上都是「该活动没有逐点数据」。
 *
 * @param activityId 活动 ID
 * @param records 逐点记录（时间序）
 * @returns 分片实体数组（seq 从 0 连续递增）
 */
export function toChunkEntities(
  activityId: string,
  records: readonly ActivityRecord[],
): ActivityChunkEntity[] {
  const chunks: ActivityChunkEntity[] = [];
  for (let start = 0; start < records.length; start += ACTIVITY_CHUNK_SIZE) {
    chunks.push({
      activityId,
      seq: start / ACTIVITY_CHUNK_SIZE,
      // 显式逐字段投影：只落规格 §18 字段清单（grade 不入库），
      // 与旧 activity_blobs 的写入口径保持一致，避免存储形状随版本漂移
      records: records.slice(start, start + ACTIVITY_CHUNK_SIZE).map(toStoredRecord),
    });
  }
  return chunks;
}

/**
 * 目标区间 `[offset, offset+limit)` 覆盖的片序范围（含两端）。
 *
 * limit <= 0 表示「读到结尾」，上界取 Number.MAX_SAFE_INTEGER：复合主键
 * 按 [activityId, seq] 逐元素比较，同 activityId 的片序都远小于该值。
 *
 * @param offset 起始偏移（负数按 0 处理）
 * @param limit 条数（0 或负数 = 全部）
 * @returns 起止片序
 */
export function chunkSeqRange(offset: number, limit: number): { startSeq: number; endSeq: number } {
  const safeOffset = Math.max(0, offset);
  const startSeq = Math.floor(safeOffset / ACTIVITY_CHUNK_SIZE);
  if (limit <= 0) {
    return { startSeq, endSeq: Number.MAX_SAFE_INTEGER };
  }
  // 末条记录的全局下标 → 所在片；跨片时会把中间片一并取回，由 sliceChunks 精确截取
  return { startSeq, endSeq: Math.floor((safeOffset + limit - 1) / ACTIVITY_CHUNK_SIZE) };
}

/**
 * 从已按 seq 升序取出的片里精确切出 `[offset, offset+limit)`。
 *
 * 片起点按首片的 seq 反推（`seq * ACTIVITY_CHUNK_SIZE`）而非按入参 offset：
 * 片齐时两者等价，但若首片缺失，按片序推算至少不会把不存在的记录算进偏移。
 *
 * @param chunks 已按 seq 升序排列的片
 * @param offset 起始偏移
 * @param limit 条数（0 或负数 = 到结尾）
 * @returns 逐点记录
 */
export function sliceChunks(
  chunks: readonly ActivityChunkEntity[],
  offset: number,
  limit: number,
): ActivityRecord[] {
  if (chunks.length === 0) {
    return [];
  }
  const flat: ActivityRecord[] = [];
  for (const chunk of chunks) {
    for (const record of chunk.records) {
      flat.push(record);
    }
  }
  const base = chunks[0].seq * ACTIVITY_CHUNK_SIZE;
  const localStart = Math.max(0, Math.max(0, offset) - base);
  return limit > 0 ? flat.slice(localStart, localStart + limit) : flat.slice(localStart);
}

/**
 * 领域逐点记录 → 落库形状（显式逐字段投影，仅规格 §18 字段清单，grade 不入库）。
 *
 * @param record 领域记录
 * @returns 落库记录
 */
export function toStoredRecord(record: ActivityRecord): ActivityRecord {
  return {
    timestamp: record.timestamp,
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    cadence: record.cadence,
    power: record.power,
    temperature: record.temperature,
  };
}
