/**
 * 设置仓库测试（规格 §18）：键值读写、覆盖、删除。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { DexieSettingsRepository } from '@/storage/repositories/settingsRepository';

describe('DexieSettingsRepository', () => {
  let db: CyclingDatabase;
  let repo: DexieSettingsRepository;

  beforeEach(() => {
    db = new CyclingDatabase();
    repo = new DexieSettingsRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('set 后 get 可读回原值（原始值与对象）', async () => {
    await repo.set('theme', 'dark');
    await repo.set('dashboard', { showCharts: true, pageSize: 10 });

    expect(await repo.get('theme')).toBe('dark');
    expect(await repo.get('dashboard')).toEqual({ showCharts: true, pageSize: 10 });
  });

  it('get 对未设置键返回 undefined', async () => {
    expect(await repo.get('not-set')).toBeUndefined();
  });

  it('重复 set 覆盖旧值', async () => {
    await repo.set('unit', 'metric');
    await repo.set('unit', 'imperial');

    expect(await repo.get('unit')).toBe('imperial');
  });

  it('delete 后 get 返回 undefined', async () => {
    await repo.set('temp', 42);
    await repo.delete('temp');

    expect(await repo.get('temp')).toBeUndefined();
  });
});
