/**
 * 导入文件台账仓库测试（规格 §18）：成功/失败记录、查询与清空。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { DexieFileRepository } from '@/storage/repositories/fileRepository';

describe('DexieFileRepository', () => {
  let db: CyclingDatabase;
  let repo: DexieFileRepository;

  beforeEach(() => {
    db = new CyclingDatabase();
    repo = new DexieFileRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('recordImported 记录成功状态与文件信息', async () => {
    await repo.recordImported('fp-1', 'ride.fit', 1024);

    const record = await repo.get('fp-1');
    expect(record).toMatchObject({
      fingerprint: 'fp-1',
      fileName: 'ride.fit',
      fileSize: 1024,
      status: 'imported',
    });
    // importedAt 为 ISO 8601 字符串
    expect(new Date(record!.importedAt).toISOString()).toBe(record!.importedAt);
  });

  it('recordFailed 记录失败状态与错误原因（文件大小记为 0）', async () => {
    await repo.recordFailed('fp-2', 'broken.fit', 'File parse failed');

    const record = await repo.get('fp-2');
    expect(record).toMatchObject({
      fingerprint: 'fp-2',
      fileName: 'broken.fit',
      fileSize: 0,
      status: 'failed',
      errorMessage: 'File parse failed',
    });
  });

  it('同一 fingerprint 重复记录时覆盖原状态', async () => {
    await repo.recordFailed('fp-3', 'retry.fit', 'first attempt failed');
    await repo.recordImported('fp-3', 'retry.fit', 2048);

    const record = await repo.get('fp-3');
    expect(record?.status).toBe('imported');
    expect(record?.errorMessage).toBeUndefined();
    expect(record?.fileSize).toBe(2048);
  });

  it('get 对未记录指纹返回 undefined', async () => {
    expect(await repo.get('unknown-fp')).toBeUndefined();
  });

  it('listAll 返回全部台账记录', async () => {
    await repo.recordImported('fp-a', 'a.fit', 100);
    await repo.recordFailed('fp-b', 'b.fit', 'boom');

    const records = await repo.listAll();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.fingerprint)).toEqual(expect.arrayContaining(['fp-a', 'fp-b']));
  });

  it('deleteAll 清空台账', async () => {
    await repo.recordImported('fp-c', 'c.fit', 300);

    await repo.deleteAll();

    expect(await repo.listAll()).toHaveLength(0);
    expect(await repo.get('fp-c')).toBeUndefined();
  });
});
