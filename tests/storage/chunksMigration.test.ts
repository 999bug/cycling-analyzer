/**
 * 第二层后台迁移测试：activity_blobs 整活动行 → activity_chunks 分片。
 *
 * 覆盖：正常搬迁、原子替换（源行删除）、幂等、空库、上一层让路、跨批、
 * 孤儿 blob（活动已删）、空记录、失败释放锁。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import {
  CHUNKS_MIGRATION_SETTINGS_KEY,
  runChunksMigration,
} from '@/storage/chunksMigration';
import { MIGRATION_SETTINGS_KEY } from '@/storage/recordsMigration';
import { ACTIVITY_CHUNK_SIZE } from '@/storage/activityChunks';
import type { MigrationProgress } from '@/storage/migrationLock';
import type { ActivityRecord } from '@/types/activity';

describe('runChunksMigration', () => {
  let db: CyclingDatabase;

  beforeEach(() => {
    db = new CyclingDatabase();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('整活动行换为分片，源行删除', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({
      activityId: 'act-1',
      records: [rec(1), rec(2), rec(3)],
    });

    const outcome = await runChunksMigration(db);

    expect(outcome).toBe('done');
    const chunks = await db.activity_chunks.where('activityId').equals('act-1').toArray();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].records).toEqual([rec(1), rec(2), rec(3)]);
    // 源行必须删掉：不删的话本次搬迁等于本地存储翻倍
    expect(await db.activity_blobs.count()).toBe(0);
  });

  it('大活动拆成多片且片序连续', async () => {
    await seedActivity(db, 'act-1');
    const records = Array.from({ length: ACTIVITY_CHUNK_SIZE * 2 + 5 }, (_, i) => rec(i));
    await db.activity_blobs.put({ activityId: 'act-1', records });

    await runChunksMigration(db);

    const chunks = await db.activity_chunks.where('activityId').equals('act-1').toArray();
    chunks.sort((a, b) => a.seq - b.seq);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.flatMap((c) => c.records)).toEqual(records);
  });

  it('blobs 为空即认为无事可做（不依赖 done 标志位，天然幂等）', async () => {
    await seedActivity(db, 'act-1');

    expect(await runChunksMigration(db)).toBe('already-done');
    // 再跑一次仍是 already-done，而不是重复搬迁
    expect(await runChunksMigration(db)).toBe('already-done');
    expect(await db.activity_chunks.count()).toBe(0);
  });

  it('搬迁完成后重跑只报 already-done', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [rec(1)] });

    expect(await runChunksMigration(db)).toBe('done');
    expect(await runChunksMigration(db)).toBe('already-done');
    expect(await db.activity_chunks.where('activityId').equals('act-1').count()).toBe(1);
  });

  it('上一层（v4→v5）仍在迁移时让路，不触碰数据', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [rec(1)] });
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() },
    });

    expect(await runChunksMigration(db)).toBe('deferred');
    expect(await db.activity_chunks.count()).toBe(0);
    expect(await db.activity_blobs.count()).toBe(1);
  });

  it('上一层心跳已过期（崩溃残留）时不阻塞本层', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [rec(1)] });
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() - 60_000 },
    });

    expect(await runChunksMigration(db)).toBe('done');
    expect(await db.activity_chunks.count()).toBe(1);
  });

  it('另一标签持本层锁时让路（busy）', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [rec(1)] });
    await db.settings.put({
      key: CHUNKS_MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() },
    });

    expect(await runChunksMigration(db)).toBe('busy');
    expect(await db.activity_chunks.count()).toBe(0);
  });

  it('跨批处理多个活动，进度单调递增至总数', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const id of ids) {
      await seedActivity(db, id);
      await db.activity_blobs.put({ activityId: id, records: [rec(1)] });
    }

    const progress: MigrationProgress[] = [];
    const outcome = await runChunksMigration(db, (p) => progress.push(p));

    expect(outcome).toBe('done');
    expect(await db.activity_blobs.count()).toBe(0);
    expect(await db.activity_chunks.count()).toBe(ids.length);
    expect(progress.at(-1)).toEqual({ migrated: ids.length, total: ids.length });
    // 单调不减
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i].migrated).toBeGreaterThanOrEqual(progress[i - 1].migrated);
    }
  });

  it('活动已被删除的孤儿源行：丢弃源行，不写孤儿分片', async () => {
    // 只写 blob 不写 activities：模拟旧版本遗留、未随级联删除清理
    await db.activity_blobs.put({ activityId: 'ghost', records: [rec(1), rec(2)] });

    expect(await runChunksMigration(db)).toBe('done');
    expect(await db.activity_blobs.count()).toBe(0);
    expect(await db.activity_chunks.count()).toBe(0);
  });

  it('空记录的活动：删源行但不写空片（读取语义同为「无逐点数据」）', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [] });

    expect(await runChunksMigration(db)).toBe('done');
    expect(await db.activity_blobs.count()).toBe(0);
    expect(await db.activity_chunks.count()).toBe(0);
  });

  it('搬迁失败时释放锁，下次启动可续跑', async () => {
    await seedActivity(db, 'act-1');
    await db.activity_blobs.put({ activityId: 'act-1', records: [rec(1)] });
    vi.spyOn(db.activity_chunks, 'bulkPut').mockRejectedValue(new Error('write failed'));

    await expect(runChunksMigration(db)).rejects.toThrow('write failed');

    // 锁已释放（不是停在 running 让后续 15 秒都无人能跑）
    const state = await db.settings.get(CHUNKS_MIGRATION_SETTINGS_KEY);
    expect((state?.value as { status?: string }).status).toBe('pending');
    // 源行仍在：分片未写入 + 源行未删是同一事务，不存在「两边都不完整」
    expect(await db.activity_blobs.count()).toBe(1);

    vi.restoreAllMocks();
    expect(await runChunksMigration(db)).toBe('done');
    expect(await db.activity_chunks.count()).toBe(1);
  });
});

/** 生成逐点记录。 */
function rec(timestamp: number): ActivityRecord {
  return { timestamp, latitude: 39.9, longitude: 116.4, altitude: 50, speed: 8.3 };
}

/** 造一条活动摘要（blob 迁移要求活动行存在）。 */
async function seedActivity(db: CyclingDatabase, id: string): Promise<void> {
  await db.activities.add({
    id,
    fileId: `file-${id}`,
    fileName: `ride-${id}.fit`,
    fingerprint: `fp-${id}`,
    activityType: 'cycling',
    startTime: '2026-08-17T08:00:00.000Z',
    endTime: '2026-08-17T09:30:00.000Z',
    duration: 5400,
    elapsedTime: 5400,
    distance: 50000,
  });
}
