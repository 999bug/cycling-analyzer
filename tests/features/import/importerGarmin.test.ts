/**
 * 导入执行器佳明标题还原测试：garminTitles 按活动开始时间匹配标题，
 * 覆盖命中、容差边界、手动标题优先与无映射兜底。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { DexieActivityRepository } from '@/storage/repositories/activityRepository';
import { DexieFileRepository } from '@/storage/repositories/fileRepository';
import { importFiles, type ImportFile } from '@/features/import/importer';
import { readFixtureBytes } from '../../helpers/fixtures';

describe('importFiles 佳明标题还原（garminTitles）', () => {
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

  /** 佳明 zip 内的原始 ID 串文件名（标题兜底会很难看的形态）。 */
  const GARMIN_RAW_NAME = 'lishiyan999@gmail.com_479400359405_16443946963.fit';

  /**
   * 构造佳明形态导入文件（内容为合成骑行 FIT 样例）。
   */
  function makeGarminImportFile(): ImportFile {
    return {
      path: `DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip/${GARMIN_RAW_NAME}`,
      name: GARMIN_RAW_NAME,
      file: new File([readFixtureBytes('cycling-gps.fit')], GARMIN_RAW_NAME),
    };
  }

  /**
   * 探测合成样例的真实开始时间（ISO）：在独立临时库导入一次读取。
   * 用于构造摘要映射（JSON 侧为毫秒），避免测试与样例内容耦合。
   */
  async function readSampleStartTimeIso(): Promise<string> {
    const probeDb = new CyclingDatabase();
    try {
      const probeActivities = new DexieActivityRepository(probeDb);
      const probeFiles = new DexieFileRepository(probeDb);
      const first = await importFiles([makeGarminImportFile()], {
        activityRepository: probeActivities,
        fileRepository: probeFiles,
      });
      expect(first.newImported).toBe(1);
      const summary = (await probeActivities.listAllSummaries())[0];
      return summary.startTime;
    } finally {
      await probeDb.delete();
    }
  }

  it('按开始时间匹配佳明活动名作为标题', async () => {
    const startTimeIso = await readSampleStartTimeIso();
    const startSec = Math.round(Date.parse(startTimeIso) / 1000);
    const titles = new Map([[startSec, '通州区 公路骑行']]);

    await importFiles([makeGarminImportFile()], {
      activityRepository,
      fileRepository,
      garminTitles: titles,
    });

    const summary = (await activityRepository.listAllSummaries())[0];
    expect(summary.name).toBe('通州区 公路骑行');
  });

  it('手动标题优先于佳明摘要匹配', async () => {
    const startTimeIso = await readSampleStartTimeIso();
    const startSec = Math.round(Date.parse(startTimeIso) / 1000);
    const titles = new Map([[startSec, '通州区 公路骑行']]);
    const entry = makeGarminImportFile();
    entry.title = '自定义标题';

    await importFiles([entry], {
      activityRepository,
      fileRepository,
      garminTitles: titles,
    });

    const summary = (await activityRepository.listAllSummaries())[0];
    expect(summary.name).toBe('自定义标题');
  });

  it('无匹配条目时回退文件名标题', async () => {
    const titles = new Map([[1, '不可能命中的活动']]);

    await importFiles([makeGarminImportFile()], {
      activityRepository,
      fileRepository,
      garminTitles: titles,
    });

    const summary = (await activityRepository.listAllSummaries())[0];
    // 文件名兜底：ID 串文件名去掉 .fit 扩展名后整体作为标题
    expect(summary.name).toBe(GARMIN_RAW_NAME.replace(/\.fit$/i, ''));
  });

  it('±2 秒容差内的开始时间命中', async () => {
    const startTimeIso = await readSampleStartTimeIso();
    const startSec = Math.round(Date.parse(startTimeIso) / 1000);
    const titles = new Map([[startSec - 2, '容差边界活动']]);

    await importFiles([makeGarminImportFile()], {
      activityRepository,
      fileRepository,
      garminTitles: titles,
    });

    const summary = (await activityRepository.listAllSummaries())[0];
    expect(summary.name).toBe('容差边界活动');
  });
});
