/**
 * 后台迁移测试：activity_records 逐点行 → activity_blobs 整活动行。
 * 覆盖：正常聚合迁移、幂等续传、空库、busy 心跳锁、过期锁接管、删除竞态跳过。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('状态已是 done 时返回 already-done（防完成横幅无限刷新循环回归）', async () => {
    // 模拟上个会话已完成迁移：本次启动不得再返回 done 触发「完成→刷新」
    await db.settings.put({
      key: MIGRATION_SETTINGS_KEY,
      value: { status: 'done', heartbeatAt: Date.now() },
    });
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);

    const outcome = await runRecordsMigration(db);

    expect(outcome).toBe('already-done');
    // 数据不被触碰（保持幂等静默）
    expect(await db.activity_blobs.count()).toBe(0);
    expect(await db.activity_records.count()).toBe(1);
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

  // 说明：CAS 的互斥由 IndexedDB 读写事务保证，单线程测试无法构造真实交错，
  // 这里验证的是「后到调用看到 running 就必须让路」这一契约不回退
  it('持锁期间后到的调用让路（busy），不重复迁移', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    let release!: () => void;
    const gate = new Promise<string[]>((resolve) => {
      release = () => resolve(['act-1']);
    });
    // 卡在「取活动主键」这一步：此时锁已写入，后到的调用必须看到 running 并让路
    vi.spyOn(db.activities, 'toCollection').mockReturnValue({
      primaryKeys: () => gate,
    } as never);

    const first = runRecordsMigration(db);
    // 轮询等到锁真正落库，再发起第二个调用（避免依赖微任务时序）
    for (let i = 0; i < 100; i += 1) {
      const entry = await db.settings.get(MIGRATION_SETTINGS_KEY);
      if ((entry?.value as { status?: string } | undefined)?.status === 'running') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const second = await runRecordsMigration(db);
    expect(second).toBe('busy');

    release();
    expect(await first).toBe('done');
  });

  it('清表失败时不标记 done（旧实现会留下「旧表已清、状态未 done」的丢数据窗口）', async () => {
    await seedLegacyActivity(db, 'act-1', [makeRecord(1)]);
    vi.spyOn(db.activity_records, 'clear').mockRejectedValue(new Error('clear failed'));

    await expect(runRecordsMigration(db)).rejects.toThrow('clear failed');

    // 旧表数据仍在：下次重跑可续跑（整活动行已在，跳过迁移后重新清表）
    // 旧实现此时旧表已被清空、状态也没写成 done，逐点数据永久丢失
    expect(await db.activity_records.count()).toBe(1);
    expect((await db.activity_blobs.get('act-1'))?.records).toEqual([makeRecord(1)]);
    const state = await db.settings.get(MIGRATION_SETTINGS_KEY);
    expect((state?.value as { status?: string }).status).not.toBe('done');
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
