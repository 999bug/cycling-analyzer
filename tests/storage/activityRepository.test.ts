/**
 * 活动仓库测试（规格 §18）：CRUD、fingerprint 唯一性、列表查询、范围聚合。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('运动类型确认标记（批量修正后不再提示）', () => {
    it('confirmActivityType 同时写入类型与 Unix 秒确认时间', async () => {
      const [activity] = await seed([{ id: 'a1', activityType: 'cycling' }])

      await repo.confirmActivityType('a1', 'running')

      const updated = await repo.getById(activity.id)
      expect(updated?.activityType).toBe('running')
      expect(updated?.typeConfirmedAt).toBeGreaterThan(0)
    })

    it('导入的活动不带确认标记（新导入视为未确认）', async () => {
      const [activity] = await seed([{ id: 'a2' }])

      expect((await repo.getById(activity.id))?.typeConfirmedAt).toBeUndefined()
    })

    it('clearTypeConfirmations 清空全部标记并返回条数，类型保持不变', async () => {
      await seed([{ id: 'a3' }, { id: 'a4' }])
      await repo.confirmActivityType('a3', 'walking')
      await repo.confirmActivityType('a4', 'cycling')

      const cleared = await repo.clearTypeConfirmations()

      expect(cleared).toBe(2)
      const a3 = await repo.getById('a3')
      expect(a3?.typeConfirmedAt).toBeUndefined()
      // 类型是用户确认的结果，重置提示不该改它
      expect(a3?.activityType).toBe('walking')
      expect((await repo.getById('a4'))?.typeConfirmedAt).toBeUndefined()
    })

    it('无标记时 clearTypeConfirmations 返回 0', async () => {
      await seed([{ id: 'a5' }])

      expect(await repo.clearTypeConfirmations()).toBe(0)
    })
  })

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
      expect(summary).toMatchObject({
        routeStartLatitude: 39.9,
        routeStartLongitude: 116.4,
        routeEndLatitude: 39.9,
        routeEndLongitude: 116.4,
      });

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

    it('getRecordsByActivityIds 单次批量查询分组返回', async () => {
      const first = makeActivity({ records: [0, 1].map(makeRecord) });
      const second = makeActivity({ records: [10, 11, 12].map(makeRecord) });
      await repo.addActivities([first, second]);

      const grouped = await repo.getRecordsByActivityIds([first.id, second.id]);

      expect(grouped.size).toBe(2);
      expect(grouped.get(first.id)!.map((r) => r.timestamp)).toEqual([0, 1]);
      expect(grouped.get(second.id)!.map((r) => r.timestamp)).toEqual([10, 11, 12]);
    });

    it('getRecordsByActivityIds：无记录的活动返回空数组，空列表返回空 Map', async () => {
      const withRecords = makeActivity({ records: [1].map(makeRecord) });
      const withoutRecords = makeActivity();
      await repo.addActivities([withRecords, withoutRecords]);

      const grouped = await repo.getRecordsByActivityIds([withRecords.id, withoutRecords.id]);
      expect(grouped.get(withRecords.id)).toHaveLength(1);
      expect(grouped.get(withoutRecords.id)).toEqual([]);

      const empty = await repo.getRecordsByActivityIds([]);
      expect(empty.size).toBe(0);
    });

    it('批量导入 addActivities', async () => {
      const first = makeActivity();
      const second = makeActivity();
      await repo.addActivities([first, second]);

      expect(await repo.countActivities()).toBe(2);
      expect((await repo.getById(second.id))?.fingerprint).toBe(second.fingerprint);
    });
  });

  describe('getRouteEndpoints', () => {
    it('摘要已有端点时直接返回，不读取逐点轨迹', async () => {
      const activity = makeActivity({ records: [makeRecord(1), makeRecord(2)] });
      await repo.addActivity(activity);
      const spy = vi.spyOn(repo, 'getRecords');

      await expect(repo.getRouteEndpoints(activity.id)).resolves.toEqual({
        start: { latitude: 39.9, longitude: 116.4 },
        end: { latitude: 39.9, longitude: 116.4 },
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('旧活动缺端点时读取一次轨迹并写回摘要，再次读取不再触碰轨迹', async () => {
      const activity = makeActivity({ records: [makeRecord(1), makeRecord(2)] });
      await repo.addActivity(activity);
      // 模拟旧活动：摘要上没有冗余端点（历史数据导入时未写入）
      await db.activities.update(activity.id, {
        routeStartLatitude: undefined,
        routeStartLongitude: undefined,
        routeEndLatitude: undefined,
        routeEndLongitude: undefined,
      });
      const spy = vi.spyOn(repo, 'getRecords');

      await expect(repo.getRouteEndpoints(activity.id)).resolves.toEqual({
        start: { latitude: 39.9, longitude: 116.4 },
        end: { latitude: 39.9, longitude: 116.4 },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      await expect(repo.getById(activity.id)).resolves.toMatchObject({
        routeStartLatitude: 39.9,
        routeStartLongitude: 116.4,
        routeEndLatitude: 39.9,
        routeEndLongitude: 116.4,
      });

      // 回填生效：第二次查询走摘要，不再反序列化逐点数据
      await repo.getRouteEndpoints(activity.id);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('无坐标点 / 不存在的活动返回 undefined', async () => {
      const activity = makeActivity({ records: [{ timestamp: 1, speed: 8.3 }] });
      await repo.addActivity(activity);

      await expect(repo.getRouteEndpoints(activity.id)).resolves.toBeUndefined();
      await expect(repo.getRouteEndpoints('not-exist')).resolves.toBeUndefined();
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

    it('按年份前缀筛选（可与月份叠加）', async () => {
      await seed([
        { startTime: '2025-07-05T08:00:00.000Z' },
        { startTime: '2026-08-15T08:00:00.000Z' },
        { startTime: '2026-09-01T08:00:00.000Z' },
      ]);
      const result = await repo.listActivities({ year: '2026' });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);

      // 年份 + 月份叠加（AND）
      const both = await repo.listActivities({ year: '2026', month: '2026-08' });
      expect(both.items).toHaveLength(1);
      expect(both.items[0].startTime).toBe('2026-08-15T08:00:00.000Z');

      const empty = await repo.listActivities({ year: '2024' });
      expect(empty.total).toBe(0);
    });

    it('日期筛选按本地日期而非 ISO 字符串前缀归类', async () => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = 'Asia/Shanghai';
      try {
        // UTC 8 月 31 日晚间在东八区已是 9 月 1 日，旧 ISO 前缀实现会错误归入 8 月。
        const localSeptember = '2026-09-01';
        const boundary = '2026-08-31T23:30:00.000Z';
        const previous = '2026-08-31T08:00:00.000Z';
        await seed([{ startTime: boundary }, { startTime: previous }]);

        const byMonth = await repo.listActivities({ month: '2026-09' });
        const byRange = await repo.listActivities({
          startTimeFrom: localSeptember,
          startTimeTo: localSeptember,
        });

        expect(byMonth.items.some((item) => item.startTime === boundary)).toBe(true);
        expect(byMonth.items.some((item) => item.startTime === previous)).toBe(false);
        expect(byRange.items.some((item) => item.startTime === boundary)).toBe(true);
        expect(byRange.items.some((item) => item.startTime === previous)).toBe(false);
      } finally {
        if (originalTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimezone;
        }
      }
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
      // v5：逐点数据整活动一行落 activity_blobs
      expect(await db.activity_blobs.get(activity.id)).toBeUndefined();
    });

    it('addActivity 以整活动一行写入 activity_blobs', async () => {
      const activity = makeActivity({ records: [makeRecord(1), makeRecord(2), makeRecord(3)] });
      await repo.addActivity(activity);

      const blob = await db.activity_blobs.get(activity.id);
      expect(blob?.records).toHaveLength(3);
      expect(blob?.records[0]).toEqual(makeRecord(1));
      // 旧逐点行表不再写入
      expect(await db.activity_records.count()).toBe(0);
    });

    it('getRecords 迁移兜底：旧逐点行数据聚合返回并回填新表', async () => {
      const activity = makeActivity();
      await repo.addActivity(activity);
      // 模拟迁移未完成：清掉新表行，往旧表插逐点行
      await db.activity_blobs.delete(activity.id);
      await db.activity_records.bulkAdd([
        { ...makeRecord(1), activityId: activity.id },
        { ...makeRecord(2), activityId: activity.id },
      ]);

      const records = await repo.getRecords(activity.id);

      expect(records).toEqual([makeRecord(1), makeRecord(2)]);
      // 回填：新表已有整活动行
      expect((await db.activity_blobs.get(activity.id))?.records).toEqual(records);
      // 后续读取走新表主键 get，返回一致
      expect(await repo.getRecords(activity.id)).toEqual(records);
    });

    it('getRecordsByActivityIds 兜底聚合旧表并回填', async () => {
      const migrated = makeActivity({ records: [makeRecord(1)] });
      const legacy = makeActivity();
      await repo.addActivities([migrated, legacy]);
      await db.activity_blobs.delete(legacy.id);
      await db.activity_records.bulkAdd([
        { ...makeRecord(1), activityId: legacy.id },
        { ...makeRecord(2), activityId: legacy.id },
      ]);

      const grouped = await repo.getRecordsByActivityIds([migrated.id, legacy.id]);

      expect(grouped.get(migrated.id)).toEqual([makeRecord(1)]);
      expect(grouped.get(legacy.id)).toEqual([makeRecord(1), makeRecord(2)]);
      expect((await db.activity_blobs.get(legacy.id))?.records).toHaveLength(2);
    });

    it('deleteActivities 批量级联删除，未列入 ID 的活动不受影响', async () => {
      const keep = makeActivity({ records: [makeRecord(1)] });
      const gone1 = makeActivity({ records: [makeRecord(1), makeRecord(2), makeRecord(3)] });
      const gone2 = makeActivity();
      await repo.addActivities([keep, gone1, gone2]);

      await repo.deleteActivities([gone1.id, gone2.id]);

      expect(await repo.countActivities()).toBe(1);
      expect(await repo.getById(gone1.id)).toBeUndefined();
      expect(await repo.getById(gone2.id)).toBeUndefined();
      expect(await repo.getRecords(gone1.id)).toHaveLength(0);
      expect((await repo.getRecords(keep.id)).length).toBe(1);
    });

    it('deleteActivities 空列表直接返回，空库删除不报错', async () => {
      await repo.deleteActivities([]);
      await repo.deleteActivities(['nonexistent-id']);

      expect(await repo.countActivities()).toBe(0);
      expect(await db.activity_records.count()).toBe(0);
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
