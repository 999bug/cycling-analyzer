/**
 * 活动仓库测试（规格 §18）：CRUD、fingerprint 唯一性、列表查询、范围聚合。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Activity, ActivityRecord } from '@/types/activity';
import { CyclingDatabase } from '@/storage/db';
import { DexieActivityRepository } from '@/storage/repositories/activityRepository';

describe('DexieActivityRepository', () => {
  let db: CyclingDatabase;
  let repo: DexieActivityRepository;

  beforeEach(() => {
    db = new CyclingDatabase();
    repo = new DexieActivityRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  /**
   * 批量写入测试活动（自动补全默认字段）。
   *
   * @param activities 部分字段覆盖列表
   * @returns 完整活动列表
   */
  async function seed(activities: Partial<Activity>[]): Promise<Activity[]> {
    const full = activities.map((overrides) => makeActivity(overrides));
    await repo.addActivities(full);
    return full;
  }

  /**
   * 生成测试活动。
   *
   * @param overrides 覆盖默认字段（含可选 records/name）
   */
  function makeActivity(overrides: Partial<Activity> = {}): Activity {
    const index = Math.floor(Math.random() * 1_000_000);
    return {
      id: `act-${index}`,
      fileId: `file-${index}`,
      fileName: `ride-${index}.fit`,
      fingerprint: `fp-${index}`,
      activityType: 'cycling',
      startTime: '2026-08-17T08:00:00.000Z',
      endTime: '2026-08-17T09:30:00.000Z',
      duration: 5400,
      elapsedTime: 5400,
      distance: 50000,
      elevationGain: 300,
      ...overrides,
    };
  }

  /**
   * 生成测试逐点记录。
   *
   * @param timestamp 时间（Unix 秒）
   */
  function makeRecord(timestamp: number): ActivityRecord {
    return { timestamp, latitude: 39.9, longitude: 116.4, altitude: 50, speed: 8.3 };
  }

  describe('addActivity / getById / getRecords', () => {
    it('写入摘要与逐点记录，getById 不含 records', async () => {
      const activity = makeActivity({ records: [makeRecord(1), makeRecord(2)] });
      await repo.addActivity(activity, '晨骑绕圈');

      const summary = await repo.getById(activity.id);
      expect(summary).toMatchObject({
        id: activity.id,
        name: '晨骑绕圈',
        fileName: activity.fileName,
        activityType: 'cycling',
        distance: 50000,
      });
      expect(summary).not.toHaveProperty('records');
      expect(summary).not.toHaveProperty('route');

      const records = await repo.getRecords(activity.id);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ timestamp: 1, latitude: 39.9, speed: 8.3 });
    });

    it('name 缺省时为 undefined，getById 返回 undefined 处理', async () => {
      const activity = makeActivity();
      await repo.addActivity(activity);

      expect((await repo.getById(activity.id))?.name).toBeUndefined();
      expect(await repo.getById('not-exist')).toBeUndefined();
    });

    it('records 为空时仅写摘要', async () => {
      const activity = makeActivity();
      await repo.addActivity(activity);
      expect(await repo.getRecords(activity.id)).toHaveLength(0);
    });

    it('getRecords 支持 offset/limit 分页', async () => {
      const activity = makeActivity({ records: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(makeRecord) });
      await repo.addActivity(activity);

      const page = await repo.getRecords(activity.id, { offset: 3, limit: 4 });
      expect(page.map((r) => r.timestamp)).toEqual([3, 4, 5, 6]);

      const tail = await repo.getRecords(activity.id, { offset: 8 });
      expect(tail.map((r) => r.timestamp)).toEqual([8, 9]);
    });

    it('批量导入 addActivities', async () => {
      const first = makeActivity();
      const second = makeActivity();
      await repo.addActivities([first, second]);

      expect(await repo.countActivities()).toBe(2);
      expect((await repo.getById(second.id))?.fingerprint).toBe(second.fingerprint);
    });
  });

  describe('fingerprint 唯一性与 existsByFingerprint', () => {
    it('重复 fingerprint 抛错且事务回滚（逐点记录不残留）', async () => {
      const first = makeActivity({ records: [makeRecord(1)] });
      await repo.addActivity(first);

      const dup = makeActivity({
        id: 'another-id',
        fingerprint: first.fingerprint,
        records: [makeRecord(2)],
      });
      await expect(repo.addActivity(dup)).rejects.toThrow();

      expect(await repo.existsByFingerprint(first.fingerprint)).toBe(true);
      expect(await repo.getRecords('another-id')).toHaveLength(0);
      expect(await repo.getById('another-id')).toBeUndefined();
    });

    it('existsByFingerprint 对未导入指纹返回 false', async () => {
      expect(await repo.existsByFingerprint('unknown-fp')).toBe(false);
    });
  });

  describe('listActivities', () => {
    it('默认按 startTime 降序，total 为全部条数', async () => {
      const [oldest, newest] = await seed([
        { startTime: '2026-07-01T08:00:00.000Z' },
        { startTime: '2026-08-17T08:00:00.000Z' },
      ]);
      const result = await repo.listActivities();
      expect(result.total).toBe(2);
      expect(result.items.map((a) => a.id)).toEqual([newest.id, oldest.id]);
    });

    it('按 distance/duration 升序与降序排序', async () => {
      const [short, long] = await seed([{ distance: 10000 }, { distance: 80000 }]);
      const asc = await repo.listActivities({ sortBy: 'distance', sortOrder: 'asc' });
      expect(asc.items.map((a) => a.id)).toEqual([short.id, long.id]);
      const desc = await repo.listActivities({ sortBy: 'distance', sortOrder: 'desc' });
      expect(desc.items.map((a) => a.id)).toEqual([long.id, short.id]);
    });

    it('分页：offset/limit 切片且 total 不随分页变化', async () => {
      await seed([
        { distance: 10 },
        { distance: 20 },
        { distance: 30 },
        { distance: 40 },
        { distance: 50 },
      ]);
      const result = await repo.listActivities({
        sortBy: 'distance',
        sortOrder: 'asc',
        offset: 1,
        limit: 2,
      });
      expect(result.total).toBe(5);
      expect(result.items.map((a) => a.distance)).toEqual([20, 30]);

      // limit 0 = 不分页，返回全部
      const all = await repo.listActivities({ sortBy: 'distance', sortOrder: 'asc', limit: 0 });
      expect(all.items).toHaveLength(5);
    });

    it('按月份前缀筛选', async () => {
      await seed([
        { startTime: '2026-07-05T08:00:00.000Z' },
        { startTime: '2026-08-15T08:00:00.000Z' },
      ]);
      const result = await repo.listActivities({ month: '2026-08' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].startTime).toBe('2026-08-15T08:00:00.000Z');
      expect(result.total).toBe(1);

      const empty = await repo.listActivities({ month: '2027-01' });
      expect(empty.items).toHaveLength(0);
      expect(empty.total).toBe(0);
    });

    it('按运动类型筛选', async () => {
      const cycling = makeActivity({ activityType: 'cycling' });
      const running = makeActivity({ activityType: 'running' });
      await repo.addActivities([cycling, running]);

      const result = await repo.listActivities({ activityType: 'running' });
      expect(result.items.map((a) => a.id)).toEqual([running.id]);
    });

    it('文本搜索匹配 fileName 与 name（不区分大小写）', async () => {
      const named = makeActivity({ fileName: 'Morning-Ride.fit' });
      const plain = makeActivity({ fileName: 'afternoon.fit' });
      // 标题通过 addActivity 的 name 参数落库（Activity 类型本身不含 name）
      await repo.addActivity(named, '温榆河绕圈');
      await repo.addActivity(plain);

      const byName = await repo.listActivities({ search: 'morning' });
      expect(byName.items.map((a) => a.id)).toEqual([named.id]);

      const byTitle = await repo.listActivities({ search: '温榆河' });
      expect(byTitle.items.map((a) => a.id)).toEqual([named.id]);

      const none = await repo.listActivities({ search: '不存在' });
      expect(none.items).toHaveLength(0);
    });

    it('按最小/最大距离筛选（单位米，含边界等于）', async () => {
      const [short, mid, long] = await seed([
        { distance: 50000 },
        { distance: 100000 },
        { distance: 150000 },
      ]);
      // 最小距离含边界：distance = 100000 满足 minDistance = 100000
      const min = await repo.listActivities({
        minDistance: 100000,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(min.items.map((a) => a.id)).toEqual([mid.id, long.id]);

      const max = await repo.listActivities({
        maxDistance: 100000,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(max.items.map((a) => a.id)).toEqual([short.id, mid.id]);

      const both = await repo.listActivities({
        minDistance: 60000,
        maxDistance: 140000,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(both.items.map((a) => a.id)).toEqual([mid.id]);
      expect(both.total).toBe(1);
    });

    it('按最小爬升/最小平均功率筛选，功率缺失的活动被排除', async () => {
      // distance 各不相同：保证 distance 升序排序下结果顺序确定
      const [low, high, noPower] = await seed([
        { distance: 10000, elevationGain: 500, avgPower: 150 },
        { distance: 20000, elevationGain: 1200, avgPower: 250 },
        { distance: 30000, elevationGain: 2000 },
      ]);
      const byGain = await repo.listActivities({
        minElevationGain: 1000,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(byGain.items.map((a) => a.id)).toEqual([high.id, noPower.id]);
      expect(byGain.items.some((a) => a.id === low.id)).toBe(false);

      // avgPower 缺失（undefined）的活动不满足任何功率条件
      const byPower = await repo.listActivities({
        minAvgPower: 200,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(byPower.items.map((a) => a.id)).toEqual([high.id]);
    });

    it('按最大爬升/最大平均功率筛选（含边界等于）', async () => {
      // distance 各不相同：保证 distance 升序排序下结果顺序确定
      const [low, mid, high] = await seed([
        { distance: 10000, elevationGain: 800, avgPower: 180 },
        { distance: 20000, elevationGain: 1000, avgPower: 200 },
        { distance: 30000, elevationGain: 1500, avgPower: 300 },
      ]);
      const result = await repo.listActivities({
        maxElevationGain: 1000,
        maxAvgPower: 200,
        sortBy: 'distance',
        sortOrder: 'asc',
      });
      expect(result.items.map((a) => a.id)).toEqual([low.id, mid.id]);
      expect(result.items.some((a) => a.id === high.id)).toBe(false);
    });

    it('数值筛选与月份/类型组合（AND 语义）', async () => {
      const [match, shortDist, wrongMonth] = await seed([
        {
          startTime: '2026-08-01T08:00:00.000Z',
          distance: 120000,
          activityType: 'cycling',
        },
        {
          startTime: '2026-08-02T08:00:00.000Z',
          distance: 90000,
          activityType: 'cycling',
        },
        {
          startTime: '2026-07-15T08:00:00.000Z',
          distance: 130000,
          activityType: 'cycling',
        },
      ]);
      const result = await repo.listActivities({
        month: '2026-08',
        activityType: 'cycling',
        minDistance: 100000,
      });
      expect(result.items.map((a) => a.id)).toEqual([match.id]);
      expect(result.total).toBe(1);

      // 数值条件单独使用时不影响其他条件（向后兼容：未传数值字段时不筛选）
      const all = await repo.listActivities({ month: '2026-08' });
      expect(all.items.map((a) => a.id)).toEqual([shortDist.id, match.id]);
      expect(all.items.some((a) => a.id === wrongMonth.id)).toBe(false);
    });

    it('数值筛选无匹配时返回空结果', async () => {
      await seed([{ distance: 50000, elevationGain: 300, avgPower: 150 }]);
      const result = await repo.listActivities({ minDistance: 100000 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('updateName / deleteActivity / deleteAll', () => {
    it('updateName 更新标题', async () => {
      const activity = makeActivity();
      await repo.addActivity(activity);
      await repo.updateName(activity.id, '环湖拉练');

      expect((await repo.getById(activity.id))?.name).toBe('环湖拉练');
    });

    it('updateNormalizedPower 回填标准化功率', async () => {
      const activity = makeActivity();
      await repo.addActivity(activity);
      await repo.updateNormalizedPower(activity.id, 233);

      expect((await repo.getById(activity.id))?.normalizedPower).toBe(233);
    });

    it('deleteActivity 级联删除逐点记录', async () => {
      const activity = makeActivity({ records: [makeRecord(1), makeRecord(2)] });
      await repo.addActivity(activity);

      await repo.deleteActivity(activity.id);

      expect(await repo.getById(activity.id)).toBeUndefined();
      expect(await repo.getRecords(activity.id)).toHaveLength(0);
      expect(await repo.countActivities()).toBe(0);
    });

    it('deleteAll 清空活动与逐点记录', async () => {
      await repo.addActivities([makeActivity({ records: [makeRecord(1)] }), makeActivity()]);

      await repo.deleteAll();

      expect(await repo.countActivities()).toBe(0);
      const all = await repo.listAllSummaries();
      expect(all).toHaveLength(0);
    });
  });

  describe('summarizeByRange / listAllSummaries', () => {
    it('聚合范围内活动（含边界）', async () => {
      await repo.addActivities([
        makeActivity({
          startTime: '2026-08-01T08:00:00.000Z',
          duration: 3600,
          distance: 30000,
          elevationGain: 100,
        }),
        makeActivity({
          startTime: '2026-08-10T08:00:00.000Z',
          duration: 5400,
          distance: 50000,
          elevationGain: 300,
        }),
        makeActivity({
          startTime: '2026-08-31T08:00:00.000Z',
          duration: 7200,
          distance: 80000,
          elevationGain: 500,
        }),
        makeActivity({
          startTime: '2026-07-20T08:00:00.000Z',
          duration: 999,
          distance: 999,
          elevationGain: 999,
        }),
      ]);

      const summary = await repo.summarizeByRange(
        '2026-08-01T00:00:00.000Z',
        '2026-08-31T23:59:59.000Z',
      );
      expect(summary).toEqual({
        count: 3,
        totalDistance: 30000 + 50000 + 80000,
        totalDuration: 3600 + 5400 + 7200,
        totalElevationGain: 100 + 300 + 500,
      });
    });

    it('范围内无活动时返回全零聚合', async () => {
      await repo.addActivities([makeActivity({ startTime: '2026-08-10T08:00:00.000Z' })]);
      const summary = await repo.summarizeByRange(
        '2025-01-01T00:00:00.000Z',
        '2025-12-31T23:59:59.000Z',
      );
      expect(summary).toEqual({
        count: 0,
        totalDistance: 0,
        totalDuration: 0,
        totalElevationGain: 0,
      });
    });

    it('listAllSummaries 按 startTime 降序返回全部摘要', async () => {
      const [oldest, newest] = await seed([
        { startTime: '2026-07-01T08:00:00.000Z' },
        { startTime: '2026-08-17T08:00:00.000Z' },
      ]);
      const all = await repo.listAllSummaries();
      expect(all.map((a) => a.id)).toEqual([newest.id, oldest.id]);
    });

    it('countActivities 统计总数', async () => {
      await repo.addActivities([makeActivity(), makeActivity(), makeActivity()]);
      expect(await repo.countActivities()).toBe(3);
    });
  });
});
