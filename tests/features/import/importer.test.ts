/**
 * 导入执行器测试（规格 §8/§9/§21/§24）：真实 FIT 样例 + fake-indexeddb 真库，
 * 覆盖导入成功、指纹去重、失败台账、.fit.gz 解压、Strava 标题还原与错误分类。
 */
import 'fake-indexeddb/auto';
import { gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { DexieActivityRepository } from '@/storage/repositories/activityRepository';
import { DexieFileRepository } from '@/storage/repositories/fileRepository';
import { classifyParseError } from '@/features/import/errorClassifier';
import { importFiles, type ImportFile } from '@/features/import/importer';
import { parseStravaActivitiesCsv } from '@/features/import/stravaExport';
import { CorruptedFitError, NotFitFileError } from '@/fit/decoder/fitDecoder';
import { computeFingerprint } from '@/utils/fingerprint';
import { randomBytes, readFixtureBytes } from '../../helpers/fixtures';

describe('importFiles 导入执行器', () => {
  let db: CyclingDatabase;
  let activityRepository: DexieActivityRepository;
  let fileRepository: DexieFileRepository;

  beforeEach(() => {
    db = new CyclingDatabase();
    activityRepository = new DexieActivityRepository(db);
    fileRepository = new DexieFileRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  /**
   * 构造导入文件（默认用合成骑行 FIT 样例）。
   *
   * @param name 文件名
   * @param bytes 文件内容（默认 cycling-gps.fit）
   */
  function makeImportFile(name: string, bytes?: ArrayBuffer): ImportFile {
    return {
      path: name,
      name,
      file: new File([bytes ?? readFixtureBytes('cycling-gps.fit')], name),
    };
  }

  /**
   * 构造 CRC 损坏的 FIT：翻转末尾两个字节。
   *
   * @param bytes 有效 FIT 字节
   */
  function tamperCrc(bytes: ArrayBuffer): ArrayBuffer {
    const copy = new Uint8Array(bytes.slice(0));
    const last = copy.length - 1;
    copy[last] = copy[last] ^ 0xff;
    copy[last - 1] = copy[last - 1] ^ 0xff;
    return copy.buffer;
  }

  /**
   * 生成 gzip 压缩的 FIT 样例（.fit.gz 场景）。
   */
  function gzipFitFixture(): ArrayBuffer {
    return gzipSync(new Uint8Array(readFixtureBytes('cycling-gps.fit'))).buffer;
  }

  it('有效 FIT 文件导入成功（活动入库 + 台账 imported）', async () => {
    const summary = await importFiles([makeImportFile('cycling-gps.fit')], {
      activityRepository,
      fileRepository,
    });

    expect(summary).toEqual({ total: 1, newImported: 1, skipped: 0, failed: 0, failedItems: [] });
    expect(await activityRepository.countActivities()).toBe(1);

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.fileName).toBe('cycling-gps.fit');
    expect(activity.activityType).toBe('cycling');
    expect(activity.distance).toBeGreaterThan(0);

    const fingerprint = await computeFingerprint(readFixtureBytes('cycling-gps.fit'));
    const record = await fileRepository.get(fingerprint);
    expect(record).toMatchObject({ fileName: 'cycling-gps.fit', status: 'imported' });
  });

  it('含功率的 FIT 导入时同步计算 NP 落库（训练状态免全量扫描）', async () => {
    await importFiles([makeImportFile('cycling-gps.fit')], { activityRepository, fileRepository });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.normalizedPower).toBeDefined();
    expect(activity.normalizedPower).toBeGreaterThan(0);
  });

  it('开启「保存原始 FIT 文件」时台账落库解压后原始字节（规格 §19）', async () => {
    const bytes = readFixtureBytes('cycling-gps.fit');
    await importFiles([makeImportFile('cycling-gps.fit')], {
      activityRepository,
      fileRepository,
      saveOriginalFit: true,
    });

    const fingerprint = await computeFingerprint(bytes);
    const record = await fileRepository.get(fingerprint);
    expect(record?.data).toBeDefined();
    expect(record?.data?.byteLength).toBe(bytes.byteLength);
  });

  it('默认不保存原始 FIT 字节（规格 §19）', async () => {
    await importFiles([makeImportFile('cycling-gps.fit')], { activityRepository, fileRepository });

    const fingerprint = await computeFingerprint(readFixtureBytes('cycling-gps.fit'));
    const record = await fileRepository.get(fingerprint);
    expect(record?.status).toBe('imported');
    expect(record?.data).toBeUndefined();
  });

  it('内容指纹重复的文件跳过（规格 §9），不重复入库', async () => {
    const entry = makeImportFile('cycling-gps.fit');
    await importFiles([entry], { activityRepository, fileRepository });

    const summary = await importFiles([entry], { activityRepository, fileRepository });

    expect(summary).toMatchObject({ total: 1, newImported: 0, skipped: 1, failed: 0 });
    expect(await activityRepository.countActivities()).toBe(1);
  });

  it('.fit.gz 解压后导入成功', async () => {
    const fitBytes = readFixtureBytes('cycling-gps.fit');
    const gzipped = gzipSync(new Uint8Array(fitBytes));

    const summary = await importFiles([makeImportFile('ride.fit.gz', gzipped.buffer)], {
      activityRepository,
      fileRepository,
    });

    expect(summary.newImported).toBe(1);
    expect(await activityRepository.countActivities()).toBe(1);
  });

  it('.fit 与 .fit.gz 同一内容指纹一致，后者被跳过', async () => {
    const fitBytes = readFixtureBytes('cycling-gps.fit');
    const gzipped = gzipSync(new Uint8Array(fitBytes));
    await importFiles([makeImportFile('ride.fit', fitBytes)], { activityRepository, fileRepository });

    const summary = await importFiles([makeImportFile('ride.fit.gz', gzipped.buffer)], {
      activityRepository,
      fileRepository,
    });

    expect(summary.skipped).toBe(1);
    expect(await activityRepository.countActivities()).toBe(1);
  });

  it('非 FIT 文件进失败台账，文案为"不是有效的 FIT 文件"', async () => {
    const bytes = randomBytes(1024);
    const summary = await importFiles([makeImportFile('not-fit.fit', bytes)], {
      activityRepository,
      fileRepository,
    });

    expect(summary).toMatchObject({ total: 1, newImported: 0, failed: 1 });
    expect(summary.failedItems[0]).toEqual({ fileName: 'not-fit.fit', error: '不是有效的 FIT 文件' });

    const fingerprint = await computeFingerprint(bytes);
    const record = await fileRepository.get(fingerprint);
    expect(record).toMatchObject({ fileName: 'not-fit.fit', status: 'failed' });
    expect(record?.errorMessage).toBe('不是有效的 FIT 文件');
  });

  it('CRC 损坏文件失败文案为"FIT 文件 CRC 校验失败"', async () => {
    const broken = tamperCrc(readFixtureBytes('cycling-gps.fit'));

    const summary = await importFiles([makeImportFile('broken.fit', broken)], {
      activityRepository,
      fileRepository,
    });

    expect(summary.failed).toBe(1);
    expect(summary.failedItems[0].error).toBe('FIT 文件 CRC 校验失败');
  });

  it('Strava 标题还原：按相对路径匹配元数据（规格 §31）', async () => {
    const csv = parseStravaActivitiesCsv(
      ['活动 ID,活动名称,活动类型,文件名', '12345,周末晨骑,骑行,activities/ride-1.fit.gz'].join('\n'),
    );
    const entry = {
      path: 'activities/ride-1.fit.gz',
      name: 'ride-1.fit.gz',
      file: new File([gzipFitFixture()], 'ride-1.fit.gz'),
    };

    await importFiles([entry], { activityRepository, fileRepository, stravaCsv: csv });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.name).toBe('周末晨骑');
  });

  it('Strava 标题还原：选择子目录时按纯文件名回退匹配', async () => {
    const csv = parseStravaActivitiesCsv(
      ['活动 ID,活动名称,文件名', '12345,环湖绕圈,activities/ride-2.fit.gz'].join('\n'),
    );
    const entry = makeImportFile('ride-2.fit.gz', gzipFitFixture());

    await importFiles([entry], { activityRepository, fileRepository, stravaCsv: csv });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.name).toBe('环湖绕圈');
  });

  it('CSV 中标题为空时不还原名称（数字 ID 文件名亦无标题可提取）', async () => {
    const csv = parseStravaActivitiesCsv(
      ['活动 ID,活动名称,文件名', '12345,,activities/12345.fit.gz'].join('\n'),
    );

    await importFiles([makeImportFile('12345.fit.gz', gzipFitFixture())], {
      activityRepository,
      fileRepository,
      stravaCsv: csv,
    });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.name).toBeUndefined();
  });

  it('Strava CSV 描述落库与估算功率填充（FIT 无功率计）', async () => {
    const csv = parseStravaActivitiesCsv(
      ['活动 ID,活动名称,活动描述,文件名,平均瓦特数', '12345,晨骑,今早风大,activities/ride-4.fit,127.0'].join('\n'),
    );

    await importFiles([makeImportFile('ride-4.fit', readFixtureBytes('hrm-activity.fit'))], {
      activityRepository,
      fileRepository,
      stravaCsv: csv,
    });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.description).toBe('今早风大');
    expect(activity.avgPower).toBe(127);
  });

  it('Strava CSV 估算功率不覆盖 FIT 实测功率', async () => {
    const csv = parseStravaActivitiesCsv(
      ['活动 ID,活动名称,活动描述,文件名,平均瓦特数', '12345,晨骑,今早风大,activities/ride-5.fit,127.0'].join('\n'),
    );

    await importFiles([makeImportFile('ride-5.fit', readFixtureBytes('cycling-gps.fit'))], {
      activityRepository,
      fileRepository,
      stravaCsv: csv,
    });

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.description).toBe('今早风大');
    expect(activity.avgPower).toBeGreaterThan(200);
    expect(activity.avgPower).not.toBe(127);
  });

  it('每个文件处理完毕回调进度', async () => {
    const progress: number[] = [];
    const entries = [makeImportFile('cycling-gps.fit'), makeImportFile('bad.fit', randomBytes(64))];

    await importFiles(entries, {
      activityRepository,
      fileRepository,
      onProgress: (current) => progress.push(current),
    });

    expect(progress).toEqual([1, 2]);
  });
});

describe('classifyParseError 错误分类（规格 §24）', () => {
  it('非 FIT 文件映射为中文文案', () => {
    expect(classifyParseError(new NotFitFileError())).toBe('不是有效的 FIT 文件');
  });

  it('CRC 损坏映射为中文文案', () => {
    expect(classifyParseError(new CorruptedFitError())).toBe('FIT 文件 CRC 校验失败');
  });

  it('其他异常保留原始错误信息', () => {
    expect(classifyParseError(new Error('boom'))).toBe('boom');
    expect(classifyParseError('oops')).toBe('oops');
  });
});
