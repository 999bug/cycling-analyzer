/**
 * GPX 活动导入端到端测试：importFiles 按扩展名分发 GPX 解析，
 * 覆盖标题链（GPX 内部名 > 文件名兜底）、.gpx.gz 解压、指纹去重。
 */
import 'fake-indexeddb/auto';
import { gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CyclingDatabase } from '@/storage/db';
import { DexieActivityRepository } from '@/storage/repositories/activityRepository';
import { DexieFileRepository } from '@/storage/repositories/fileRepository';
import { importFiles, type ImportFile } from '@/features/import/importer';

/** 最小可用 GPX（带内部轨迹名与两点轨迹） */
function gpxWithTrackName(name: string): string {
  return `<?xml version="1.0"?>
<gpx creator="StravaGPX">
  <trk>
    <name>${name}</name>
    <trkseg>
      <trkpt lat="39.9400" lon="116.1000"><ele>100</ele><time>2024-05-01T01:00:00Z</time></trkpt>
      <trkpt lat="39.9500" lon="116.1100"><ele>120</ele><time>2024-05-01T01:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`
}

/** 无内部名的 GPX（标题走文件名兜底） */
const gpxWithoutName = `<?xml version="1.0"?>
<gpx creator="t">
  <trk><trkseg>
    <trkpt lat="39.9400" lon="116.1000"><time>2024-05-01T01:00:00Z</time></trkpt>
    <trkpt lat="39.9500" lon="116.1100"><time>2024-05-01T01:30:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`

describe('importFiles GPX 导入', () => {
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
   * 构造导入文件（文本内容）。
   *
   * @param name 文件名
   * @param content 文本内容
   */
  function makeTextFile(name: string, content: string): ImportFile {
    return {
      path: name,
      name,
      file: new File([new TextEncoder().encode(content)], name),
    };
  }

  it('.gpx 导入成功：活动入库、标题取 GPX 内部名、台账 imported', async () => {
    const summary = await importFiles(
      [makeTextFile('2024-05-01-晨骑.gpx', gpxWithTrackName('晨骑妙峰山'))],
      { activityRepository, fileRepository },
    );

    expect(summary).toEqual({ total: 1, newImported: 1, skipped: 0, failed: 0, failedItems: [] });
    expect(await activityRepository.countActivities()).toBe(1);

    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.fileName).toBe('2024-05-01-晨骑.gpx');
    expect(activity.name).toBe('晨骑妙峰山');
    // GPX 无功率数据：标准化功率不伪造
    expect(activity.normalizedPower).toBeUndefined();
    expect(activity.distance).toBeGreaterThan(1000);
    // 台账记录为导入成功（无原始字节）
    const record = await fileRepository.get(activity.fingerprint);
    expect(record?.status).toBe('imported');
  });

  it('无内部名时标题回退文件名去扩展名；纯数字文件名跳过兜底', async () => {
    await importFiles([makeTextFile('环湖骑行.gpx', gpxWithoutName)], {
      activityRepository,
      fileRepository,
    });
    const first = (await activityRepository.listAllSummaries())[0];

    await importFiles([makeTextFile('1234567890.gpx', gpxWithoutName)], {
      activityRepository,
      fileRepository,
    });
    const all = await activityRepository.listAllSummaries();
    const digitNamed = all.find((a) => a.fileName === '1234567890.gpx');

    expect(first.name).toBe('环湖骑行');
    expect(digitNamed?.name).toBeUndefined();
  });

  it('.gpx.gz 自动解压后正常解析', async () => {
    const gz = gzipSync(new TextEncoder().encode(gpxWithTrackName('压缩晨骑')));
    const summary = await importFiles(
      [
        {
          path: 'ride.gpx.gz',
          name: 'ride.gpx.gz',
          file: new File([gz], 'ride.gpx.gz'),
        },
      ],
      { activityRepository, fileRepository },
    );

    expect(summary.newImported).toBe(1);
    const activity = (await activityRepository.listAllSummaries())[0];
    expect(activity.name).toBe('压缩晨骑');
  });

  it('同内容重复导入按指纹跳过（.gpx 与 .gpx.gz 同活动判重一致）', async () => {
    const first = await importFiles([makeTextFile('a.gpx', gpxWithTrackName('晨骑'))], {
      activityRepository,
      fileRepository,
    });
    const secondPlain = await importFiles([makeTextFile('b.gpx', gpxWithTrackName('晨骑'))], {
      activityRepository,
      fileRepository,
    });
    const gz = gzipSync(new TextEncoder().encode(gpxWithTrackName('晨骑')));
    const secondGz = await importFiles(
      [{ path: 'c.gpx.gz', name: 'c.gpx.gz', file: new File([gz], 'c.gpx.gz') }],
      { activityRepository, fileRepository },
    );

    expect(first.newImported).toBe(1);
    expect(secondPlain.skipped).toBe(1);
    expect(secondGz.skipped).toBe(1);
    expect(await activityRepository.countActivities()).toBe(1);
  });

  it('损坏的 GPX 进入失败列表且台账记录失败原因', async () => {
    const summary = await importFiles([makeTextFile('broken.gpx', '<gpx><trk>')], {
      activityRepository,
      fileRepository,
    });

    expect(summary.failed).toBe(1);
    expect(summary.failedItems[0].error).toBe('Invalid GPX file');
    expect(await activityRepository.countActivities()).toBe(0);
  });

  it('FIT 与 GPX 混合批次各自分发解析器', async () => {
    const { readFixtureBytes } = await import('../../helpers/fixtures');
    const fitBytes = readFixtureBytes('cycling-gps.fit');
    const summary = await importFiles(
      [
        {
          path: 'from-device.fit',
          name: 'from-device.fit',
          file: new File([fitBytes.slice(0)], 'from-device.fit'),
        },
        makeTextFile('from-app.gpx', gpxWithTrackName('手机记录')),
      ],
      { activityRepository, fileRepository },
    );

    expect(summary).toEqual({ total: 2, newImported: 2, skipped: 0, failed: 0, failedItems: [] });
    const names = (await activityRepository.listAllSummaries()).map((a) => a.name).sort();
    // FIT 走文件名兜底，GPX 取内部名
    expect(names).toEqual(['from-device', '手机记录']);
  });
});
