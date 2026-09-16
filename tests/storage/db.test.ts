/**
 * 数据库定义测试（规格 §18）：库名、版本、十张表与索引结构
 * （v2 segments，v3 tile_cache，v4 scan_cache，v6 segment_efforts，v7 error_logs）。
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

  it('打开后十张表齐全', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual([
      'activities',
      'activity_blobs',
      'activity_records',
      'error_logs',
      'files',
      'scan_cache',
      'segment_efforts',
      'segments',
      'settings',
      'tile_cache',
    ]);
    await db.close();
  });

  it('segment_efforts 表（v6）有 segmentId/activityId 索引与 [segmentId+activityId] 唯一复合索引', async () => {
    const db = new CyclingDatabase();
    await db.open();
    const schema = db.segment_efforts.schema;
    expect(schema.primKey.auto).toBe(true);
    const indexes = new Map(schema.indexes.map((index) => [index.name, index]));
    expect(indexes.has('segmentId')).toBe(true);
    expect(indexes.has('activityId')).toBe(true);
    expect(indexes.has('[segmentId+activityId]')).toBe(true);
    expect(indexes.get('[segmentId+activityId]')?.unique).toBe(true);
    await db.close();
  });

  it('scan_cache 表以 name 为主键', async () => {
    const db = new CyclingDatabase();
    await db.open();
    expect(db.scan_cache.schema.primKey.name).toBe('name');
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
