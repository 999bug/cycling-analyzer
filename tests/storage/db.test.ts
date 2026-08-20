/**
 * 数据库定义测试（规格 §18）：库名、版本、六张表与索引结构（v2 新增 segments，v3 新增 tile_cache）。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CyclingDatabase, DB_NAME, DB_VERSION } from '@/storage/db';

describe('CyclingDatabase', () => {
  it('库名与版本号正确', () => {
    const db = new CyclingDatabase();
    expect(db.name).toBe(DB_NAME);
    expect(db.verno).toBe(DB_VERSION);
  });

  it('打开后六张表齐全', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual([
      'activities',
      'activity_records',
      'files',
      'segments',
      'settings',
      'tile_cache',
    ]);
    await db.close();
  });

  it('tile_cache 表以 url 为主键、按 lastAccess 建索引', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const schema = db.tile_cache.schema;
    expect(schema.primKey.name).toBe('url');
    expect(schema.indexes.map((index) => index.name)).toContain('lastAccess');
    await db.close();
  });

  it('activities 表声明主键与 fingerprint/startTime/activityType 索引', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const schema = db.activities.schema;
    expect(schema.primKey.name).toBe('id');

    const indexes = new Map(schema.indexes.map((index) => [index.name, index]));
    expect(indexes.has('fingerprint')).toBe(true);
    expect(indexes.has('startTime')).toBe(true);
    expect(indexes.has('activityType')).toBe(true);

    // fingerprint 唯一索引（重复检测依赖唯一约束）
    expect(indexes.get('fingerprint')?.unique).toBe(true);
    await db.close();
  });

  it('activity_records 表按 activityId 建索引、自增主键', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const schema = db.activity_records.schema;
    expect(schema.primKey.auto).toBe(true);
    expect(schema.indexes.map((index) => index.name)).toContain('activityId');
    await db.close();
  });
});
