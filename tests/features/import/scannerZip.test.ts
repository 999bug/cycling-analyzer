/**
 * 扫描器 zip 展开测试：内存构造 zip（fflate zipSync），覆盖平铺包、
 * 佳明 GDPR 两层嵌套包（外层 zip → 内层 UploadedFiles zip → FIT + 摘要 JSON）
 * 与损坏 zip 的警告降级。
 */
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  collectFitFiles,
  emptyScanResult,
  expandArchives,
  isZipFileName,
  type ScanResult,
} from '@/features/import/scanner';
import { readFixtureBytes } from '../../helpers/fixtures';

/**
 * 构造 zip 文件。
 *
 * @param entries 条目名 → 内容（字符串走 UTF-8，Uint8Array 原样）
 * @param name zip 文件名
 */
function makeZipFile(entries: Record<string, Uint8Array>, name = 'export.zip'): File {
  return new File([zipSync(entries)], name);
}

/**
 * 构造含单个 FIT 的 zip。
 *
 * @param name zip 文件名
 * @param fitName 内部 FIT 条目名
 */
function makeFitZip(name: string, fitName = 'ride.fit'): File {
  return makeZipFile({ [fitName]: new Uint8Array(readFixtureBytes('cycling-gps.fit')) }, name);
}

/**
 * 构造佳明 GDPR 外层 zip：内层 UploadedFiles zip + 活动摘要 JSON。
 *
 * @param name 外层 zip 文件名
 */
function makeGarminGdprZip(name = 'garmin-gdpr.zip'): File {
  const innerZip = zipSync({
    'lishiyan999@gmail.com_479400359405_16443946963.fit': new Uint8Array(
      readFixtureBytes('cycling-gps.fit'),
    ),
  });
  const summaries = JSON.stringify([
    {
      summarizedActivitiesExport: [
        { activityId: 24267683633, name: '通州区 公路骑行', startTimeGmt: Date.now() },
      ],
    },
  ]);
  return makeZipFile(
    {
      'DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip': innerZip,
      'DI_CONNECT/DI-Connect-Fitness/user_1_summarizedActivities.json': strToU8(summaries),
      'DI_CONNECT/DI-Connect-User/user_profile.json': strToU8('{}'),
    },
    name,
  );
}

describe('isZipFileName', () => {
  it('识别 .zip（不区分大小写），不误判其他扩展名', () => {
    expect(isZipFileName('export.zip')).toBe(true);
    expect(isZipFileName('EXPORT.ZIP')).toBe(true);
    expect(isZipFileName('export.zipx')).toBe(false);
    expect(isZipFileName('ride.fit')).toBe(false);
  });
});

/** 构造普通文件（zip 测试辅助）。 */
function makeFilePlain(name: string): File {
  return new File(['x'], name);
}

describe('collectFitFiles 登记 zip（不展开）', () => {
  it('zip 收进 archives，活动文件照常进 files', () => {
    const result = collectFitFiles([makeFitZip('a.zip'), makeFilePlain('b.fit')]);

    expect(result.archives.map((a) => a.name)).toEqual(['a.zip']);
    expect(result.files.map((f) => f.name)).toEqual(['b.fit']);
    expect(result.warnings).toEqual([]);
  });

  it('佳明摘要 JSON 收进 garminJson', () => {
    const json = new File(['[]'], 'user_1_summarizedActivities.json');
    const result = collectFitFiles([json, makeFilePlain('c.fit')]);

    expect(result.garminJson?.name).toBe('user_1_summarizedActivities.json');
    expect(result.files.map((f) => f.name)).toEqual(['c.fit']);
  });
});

describe('expandArchives zip 展开', () => {
  it('展开平铺 zip：FIT 进 files、activities.csv 进 csvFile', async () => {
    const result: ScanResult = emptyScanResult();
    result.archives.push({
      path: 'strava-export.zip',
      name: 'strava-export.zip',
      file: makeZipFile({
        'activities.csv': strToU8('活动 ID,活动名称'),
        'activities/ride-1.fit.gz': new Uint8Array(readFixtureBytes('cycling-gps.fit')),
      }),
    });

    await expandArchives(result);

    expect(result.archives).toEqual([]);
    expect(result.files.map((f) => f.name)).toEqual(['ride-1.fit.gz']);
    expect(result.files[0].path).toBe('strava-export.zip/activities/ride-1.fit.gz');
    expect(result.csvFile?.name).toBe('activities.csv');
  });

  it('展开佳明 GDPR 两层嵌套包：内层 FIT + 摘要 JSON 均收集', async () => {
    const result: ScanResult = emptyScanResult();
    result.archives.push({
      path: 'garmin-gdpr.zip',
      name: 'garmin-gdpr.zip',
      file: makeGarminGdprZip(),
    });

    await expandArchives(result);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('lishiyan999@gmail.com_479400359405_16443946963.fit');
    expect(result.files[0].path).toBe(
      'garmin-gdpr.zip/DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip/' +
        'lishiyan999@gmail.com_479400359405_16443946963.fit',
    );
    expect(result.garminJson?.name).toBe('user_1_summarizedActivities.json');
    // 无关 JSON（user_profile.json）不入任何收集字段
    expect(result.warnings).toEqual([]);
  });

  it('损坏 zip 记录警告且不阻断（其余文件保留）', async () => {
    const result: ScanResult = emptyScanResult();
    result.files.push({ path: 'good.fit', name: 'good.fit', file: makeFilePlain('good.fit') });
    result.archives.push({
      path: 'broken.zip',
      name: 'broken.zip',
      file: new File([new Uint8Array([0x50, 0x4b, 0x00, 0x00])], 'broken.zip'),
    });

    await expandArchives(result);

    expect(result.files.map((f) => f.name)).toEqual(['good.fit']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('broken.zip');
  });

  it('超出深度上限的嵌套 zip 不再展开（默认 2 层）', async () => {
    const deepest = zipSync({ 'deep.fit': new Uint8Array(readFixtureBytes('cycling-gps.fit')) });
    const mid = zipSync({ 'inner.zip': deepest });
    const result: ScanResult = emptyScanResult();
    result.archives.push({
      path: 'outer.zip',
      name: 'outer.zip',
      file: new File([zipSync({ 'mid.zip': mid })], 'outer.zip'),
    });

    await expandArchives(result, { depth: 1 });

    // depth=1 只展开外层：mid.zip 成为待展开 archive，deep.fit 未被收集
    expect(result.files).toEqual([]);
    expect(result.archives.map((a) => a.name)).toEqual(['mid.zip']);
  });
});
