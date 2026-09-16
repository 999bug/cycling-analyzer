/**
 * 逐点分片纯逻辑测试。
 *
 * 覆盖的是「读取静默少点/错位」这类最难端到端定位的问题：分片边界、区间换算、
 * 跨片截取、越界。这些是纯算术，必须用边界值钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CHUNK_SIZE,
  chunkSeqRange,
  sliceChunks,
  toChunkEntities,
  toStoredRecord,
} from '@/storage/activityChunks';
import type { ActivityChunkEntity } from '@/storage/db';
import type { ActivityRecord } from '@/types/activity';

describe('toChunkEntities', () => {
  it('无记录时不写任何片', () => {
    expect(toChunkEntities('a', [])).toEqual([]);
  });

  it('不足一片时产出单一片，seq 为 0', () => {
    const chunks = toChunkEntities('a', [rec(1), rec(2)]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].activityId).toBe('a');
    expect(chunks[0].seq).toBe(0);
    expect(chunks[0].records).toEqual([rec(1), rec(2)]);
  });

  it('恰好一片时不多产出空片', () => {
    const records = Array.from({ length: ACTIVITY_CHUNK_SIZE }, (_, i) => rec(i));
    const chunks = toChunkEntities('a', records);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].records).toHaveLength(ACTIVITY_CHUNK_SIZE);
  });

  it('超出一片时 seq 从 0 连续递增，片内保持原顺序', () => {
    const records = Array.from({ length: ACTIVITY_CHUNK_SIZE + 3 }, (_, i) => rec(i));
    const chunks = toChunkEntities('a', records);

    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    expect(chunks[0].records[0]).toEqual(rec(0));
    expect(chunks[0].records.at(-1)).toEqual(rec(ACTIVITY_CHUNK_SIZE - 1));
    expect(chunks[1].records).toEqual([rec(ACTIVITY_CHUNK_SIZE), rec(ACTIVITY_CHUNK_SIZE + 1), rec(ACTIVITY_CHUNK_SIZE + 2)]);
  });

  it('片序与全局下标的关系：第 n 片首条 = 第 n*SIZE 条', () => {
    const records = Array.from({ length: ACTIVITY_CHUNK_SIZE * 3 }, (_, i) => rec(i));
    const chunks = toChunkEntities('a', records);
    const flat = chunks.flatMap((c) => c.records);

    expect(flat).toEqual(records);
    chunks.forEach((chunk, index) => {
      expect(chunk.seq).toBe(index);
    });
  });

  it('只落规格字段：grade 不进存储（与旧布局写入口径一致）', () => {
    const stored = toStoredRecord({ ...rec(1), grade: 7.5 });

    expect(stored).toEqual(rec(1));
    expect('grade' in stored).toBe(false);
  });
});

describe('chunkSeqRange', () => {
  it('取全部（limit 省略为 0）时上界为安全整数，覆盖所有片', () => {
    expect(chunkSeqRange(0, 0)).toEqual({ startSeq: 0, endSeq: Number.MAX_SAFE_INTEGER });
  });

  it('区间落在单片内时不扩大范围', () => {
    expect(chunkSeqRange(0, 100)).toEqual({ startSeq: 0, endSeq: 0 });
    expect(chunkSeqRange(ACTIVITY_CHUNK_SIZE - 1, 1)).toEqual({ startSeq: 0, endSeq: 0 });
    expect(chunkSeqRange(ACTIVITY_CHUNK_SIZE, 1)).toEqual({ startSeq: 1, endSeq: 1 });
  });

  it('区间跨片时两端都取到（末条索引决定上界）', () => {
    // 3900~4099：跨第 1、2 片
    expect(chunkSeqRange(3900, 200)).toEqual({ startSeq: 1, endSeq: 2 });
    // 0~SIZE+1：跨第 0、1 片
    expect(chunkSeqRange(0, ACTIVITY_CHUNK_SIZE + 1)).toEqual({ startSeq: 0, endSeq: 1 });
  });

  it('负偏移按 0 处理（避免得到负片序）', () => {
    expect(chunkSeqRange(-10, 5)).toEqual({ startSeq: 0, endSeq: 0 });
  });
});

describe('sliceChunks', () => {
  it('无片时返回空', () => {
    expect(sliceChunks([], 0, 10)).toEqual([]);
  });

  it('单片内精确截取', () => {
    const chunks = [chunk(1, [rec(2000), rec(2001), rec(2002)])];

    expect(sliceChunks(chunks, 2001, 1)).toEqual([rec(2001)]);
    expect(sliceChunks(chunks, 2000, 0)).toEqual([rec(2000), rec(2001), rec(2002)]);
  });

  it('跨片按片序拼接后截取（片序不是从 0 开始时以首片反推偏移）', () => {
    const chunks = [chunk(1, [rec(2000), rec(2001)]), chunk(2, [rec(4000), rec(4001)])];

    expect(sliceChunks(chunks, 2001, 2)).toEqual([rec(2001), rec(4000)]);
  });

  it('偏移超出实际数据时返回空数组（而不是回退成返回全量）', () => {
    const chunks = [chunk(0, [rec(0), rec(1)])];

    expect(sliceChunks(chunks, 99, 10)).toEqual([]);
  });
});

/** 生成逐点记录（timestamp 即序号，便于断言）。 */
function rec(timestamp: number): ActivityRecord {
  return { timestamp, latitude: 39.9, longitude: 116.4, altitude: 50, speed: 8.3 };
}

/** 构造一个分片实体。 */
function chunk(seq: number, records: ActivityRecord[]): ActivityChunkEntity {
  return { activityId: 'a', seq, records };
}
