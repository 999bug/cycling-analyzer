/**
 * 佳明 GDPR 导出适配测试：路径/文件名识别、活动摘要解析与开始时间标题匹配。
 */
import { describe, expect, it } from 'vitest';
import {
  GARMIN_TITLE_MATCH_TOLERANCE_SEC,
  isGarminSummariesName,
  isGarminUploadedZipPath,
  matchGarminTitle,
  parseGarminSummaries,
} from '@/features/import/garminExport';

describe('佳明 GDPR 路径与文件名识别', () => {
  it('识别 UploadedFiles 内层 zip 特征路径（不区分大小写）', () => {
    expect(
      isGarminUploadedZipPath(
        'c380e281_1/DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip',
      ),
    ).toBe(true);
    expect(isGarminUploadedZipPath('di_connect/di-connect-uploaded-files/uploadedfiles.zip')).toBe(
      true,
    );
  });

  it('普通 zip 路径不误判为佳明已上传文件包', () => {
    expect(isGarminUploadedZipPath('strava-export.zip')).toBe(false);
    expect(isGarminUploadedZipPath('activities/uploaded.zip')).toBe(false);
  });

  it('识别活动摘要 JSON 文件名（不区分大小写）', () => {
    expect(isGarminSummariesName('lishiyan999@gmail.com_1_summarizedActivities.json')).toBe(true);
    expect(isGarminSummariesName('SUMMARIZEDACTIVITIES.JSON')).toBe(true);
    expect(isGarminSummariesName('user_profile.json')).toBe(false);
    expect(isGarminSummariesName('activities.json')).toBe(false);
  });
});

describe('parseGarminSummaries 摘要解析', () => {
  it('解析标准 GDPR 结构（[{ summarizedActivitiesExport: [...] }]）', () => {
    const json = JSON.stringify([
      {
        summarizedActivitiesExport: [
          { activityId: 1, name: '通州区 公路骑行', startTimeGmt: 1748435776000 },
          { activityId: 2, name: '承德市 公路骑行', startTimeGmt: 1754710002000 },
        ],
      },
    ]);

    const titles = parseGarminSummaries(json);

    expect(titles.size).toBe(2);
    expect(titles.get(1748435776)).toBe('通州区 公路骑行');
    expect(titles.get(1754710002)).toBe('承德市 公路骑行');
  });

  it('毫秒转秒并四舍五入', () => {
    const titles = parseGarminSummaries(
      JSON.stringify([
        { summarizedActivitiesExport: [{ name: '晨骑', startTimeGmt: 1748435776500 }] },
      ]),
    );

    expect(titles.get(1748435777)).toBe('晨骑');
  });

  it('非法 JSON 与非数组结构返回空映射', () => {
    expect(parseGarminSummaries('not json').size).toBe(0);
    expect(parseGarminSummaries('{"a":1}').size).toBe(0);
    expect(parseGarminSummaries('[{"other":[]}]').size).toBe(0);
  });

  it('缺时间/空名的条目跳过，同秒首见保留', () => {
    const json = JSON.stringify([
      {
        summarizedActivitiesExport: [
          { name: '无时间' },
          { startTimeGmt: 1748435776000 },
          { name: '   ', startTimeGmt: 1748435775000 },
          { name: '第一条', startTimeGmt: 1748435740000 },
          { name: '第二条', startTimeGmt: 1748435740500 },
        ],
      },
    ]);

    const titles = parseGarminSummaries(json);

    expect(titles.size).toBe(2);
    expect(titles.get(1748435740)).toBe('第一条');
  });
});

describe('matchGarminTitle 开始时间匹配', () => {
  const titles = parseGarminSummaries(
    JSON.stringify([
      {
        summarizedActivitiesExport: [{ name: '通州区 公路骑行', startTimeGmt: 1748435776000 }],
      },
    ]),
  );

  it('精确匹配（ISO 时间 → 秒）', () => {
    expect(matchGarminTitle(titles, '2025-05-28T12:36:16.000Z')).toBe('通州区 公路骑行');
  });

  it('容差内命中（±2 秒）', () => {
    expect(matchGarminTitle(titles, '2025-05-28T12:36:17.000Z')).toBe('通州区 公路骑行');
    expect(matchGarminTitle(titles, '2025-05-28T12:36:15.000Z')).toBe('通州区 公路骑行');
    expect(GARMIN_TITLE_MATCH_TOLERANCE_SEC).toBe(2);
  });

  it('超出容差未命中返回 undefined', () => {
    expect(matchGarminTitle(titles, '2025-05-28T12:36:19.000Z')).toBeUndefined();
  });

  it('非法 ISO 时间返回 undefined', () => {
    expect(matchGarminTitle(titles, 'not-a-date')).toBeUndefined();
  });
});
