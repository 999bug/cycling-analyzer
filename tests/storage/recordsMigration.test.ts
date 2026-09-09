/**
 * 后台迁移测试：activity_records 逐点行 → activity_blobs 整活动行。
 * 覆盖：正常聚合迁移、幂等续传、空库、busy 心跳锁、过期锁接管、删除竞态跳过。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { MIGRATION_SETTINGS_KEY, runRecordsMigration, type MigrationProgress } from '@/storage/recordsMigration';
import type { ActivityRecord } from '@/types/activity';

describe('runRecordsMigration', () => {
  let db: CyclingDatabase;

  beforeEach(() => {
    db = new CyclingDatabase();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('旧逐点行聚合为整活动行，旧表清空，状态标记 done', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1), makeRecord(2), makeRecord(3)]);
    await seedLegacyActivity(db, 'act-2', []);

    const progress: MigrationProgress[] = [];
    const outcome = await runRecordsMigration(db, (p) => progress.push(p));

    expect(outcome).toBe('done');
    const blob1 = await db.activity_blobs.get('act-1');
    expect(blob1?.records).toHaveLength(3);
    // 剥壳：仅领域记录字段，无 activityId/id 附加键
    expect(blob1?.records[0]).toEqual(makeRecord(1));
    expect(blob1?.records[2]).toEqual(makeRecord(3));
    // 无逐点记录的活动也落一行空数组（保证完成判定与读取一致性）
    expect((await db.activity_blobs.get('act-2'))?.records).toEqual([]);
    expect(await db.activity_records.count()).toBe(0);
    const state = await db.settings.get(MIGRATION_SETTINGS_KEY);
    expect((state?.value as { status?: string }).status).toBe('done');
    // 进度单调递增至总数
    expect(progress.at(-1)).toEqual({ migrated: 2, total: 2 });
  });

  it('幂等续传：部分迁移后重跑只补缺口', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    await seedLegacyActivity(db, 'act-2', [makeRecord(2)]);
    // 模拟中断：act-1 已迁移，状态停在中断现场
    await db.activity_blobs.put({ activityId: 'act-1', records: [makeRecord(1)] });

    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('done');
    expect(await db.activity_blobs.count()).toBe(2);
    expect((await db.activity_blobs.get('act-2'))?.records).toEqual([makeRecord(2)]);
    expect(await db.activity_records.count()).toBe(0);
  });

  it('空库直接完成', async () => {
    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('done');
    expect(await db.activity_blobs.count()).toBe(0);
  });

  it('另一标签持新鲜心跳锁时让路（busy），数据不动', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() },
    });

    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('busy');
    expect(await db.activity_blobs.count()).toBe(0);
    expect(await db.activity_records.count()).toBe(1);
  });

  it('过期心跳锁被接管，迁移正常完成', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'running', heartbeatAt: Date.now() - 60_000 },
    });

    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('done');
    expect(await db.activity_blobs.count()).toBe(1);
    expect(await db.activity_records.count()).toBe(0);
  });

  it('迁移期间活动被删除：跳过该活动，不写孤儿行', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    // 模拟删除竞态：清单快照后活动行被删，旧逐点行已随级联删除清理
    await db.activities.delete('act-1');
    await db.activity_records.where('activityId').equals('act-1').delete();

    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('done');
    expect(await db.activity_blobs.count()).toBe(0);
  });
});

/** 生成领域逐点记录。 */
function makeRecord(timestamp: number): ActivityRecord {
  return { timestamp, latitude: 39.9, longitude: 116.4, altitude: 50, speed: 8.3 };
}

/** 按旧 schema 造一个活动：activities 摘要 + activity_records 逐点行。 */
async function seedLegacyActivity(
  db: CyclingDatabase,
  id: string,
  records: ActivityRecord[],
): Promise<void> {
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
  for (const record of records) {
    await db.activity_records.add({ ...record, activityId: id });
  }
}
