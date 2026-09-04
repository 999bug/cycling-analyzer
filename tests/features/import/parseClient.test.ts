/**
 * worker 解析客户端协议测试。
 *
 * jsdom 无真实 Worker，用 FakeWorker 模拟：收到请求后调用与 worker 相同的
 * parseFitBytes 纯函数并回传响应，验证 createWorkerParser 的消息分发
 * （请求/响应 id 关联、成功与失败路径）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerParser } from '@/features/import/parseClient';
import { parseFitBytes, type ParseRequest, type ParseResponse } from '@/fit/worker/parseTask';
import { classifyParseError } from '@/features/import/errorClassifier';
import { computeFingerprint } from '@/utils/fingerprint';
import { randomBytes, readFixtureBytes } from '../../helpers/fixtures';

/**
 * 模拟 worker：行为与 parseWorker.ts 一致（消息分发 + parseFitBytes）。
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<ParseResponse>) => void) | null = null;

  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: ParseRequest): void {
    setTimeout(() => {
      let response: ParseResponse;
      try {
        response = { id: message.id, ok: true, activity: parseFitBytes(message) };
      } catch (error) {
        response = { id: message.id, ok: false, errorMessage: classifyParseError(error) };
      }
      this.onmessage?.({ data: response } as MessageEvent<ParseResponse>);
    }, 0);
  }

  // parseClient 错误兜底与 dispose() 会调用；测试中为 noop
  terminate(): void {}
}

describe('createWorkerParser 消息协议', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('有效 FIT 字节解析为 Activity', async () => {
    const handle = createWorkerParser();
    const bytes = readFixtureBytes('cycling-gps.fit');
    const fingerprint = await computeFingerprint(bytes);

    const activity = await handle.parse({ fileName: 'cycling-gps.fit', bytes, fingerprint });

    expect(activity.fileName).toBe('cycling-gps.fit');
    expect(activity.fingerprint).toBe(fingerprint);
    expect(activity.activityType).toBe('cycling');
    expect(activity.records?.length).toBe(120);
    handle.dispose();
  });

  it('解析失败返回分类后的错误文案', async () => {
    const handle = createWorkerParser();
    const bytes = randomBytes(1024);
    const fingerprint = await computeFingerprint(bytes);

    await expect(
      handle.parse({ fileName: 'bad.fit', bytes, fingerprint }),
    ).rejects.toThrow('不是有效的 FIT 文件');
    handle.dispose();
  });

  it('并发请求按 id 关联各自响应', async () => {
    const handle = createWorkerParser();
    const validBytes = readFixtureBytes('cycling-gps.fit');
    const badBytes = randomBytes(1024);
    const validFingerprint = await computeFingerprint(validBytes);
    const badFingerprint = await computeFingerprint(badBytes);

    const valid = handle.parse({
      fileName: 'good.fit',
      bytes: validBytes,
      fingerprint: validFingerprint,
    });
    const bad = handle.parse({
      fileName: 'bad.fit',
      bytes: badBytes,
      fingerprint: badFingerprint,
    });

    const activity = await valid;
    expect(activity.fileName).toBe('good.fit');
    await expect(bad).rejects.toThrow('不是有效的 FIT 文件');
    handle.dispose();
  });

  it('worker OOM 无响应时 dispose 主动终止未决请求', async () => {
    const handle = createWorkerParser();
    const bytes = readFixtureBytes('cycling-gps.fit');
    const fingerprint = await computeFingerprint(bytes);

    // 覆盖 Worker 为不回复（模拟 OOM 挂起）
    vi.stubGlobal('Worker', class StalledWorker {
      onmessage: ((event: MessageEvent<ParseResponse>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(): void {
        // 故意不回复
      }
      terminate(): void {}
    });

    try {
      // dispose 走与超时同一条 rejectAll 路径，覆盖 OOM 场景
      const promise = handle.parse({ fileName: 'stalled.fit', bytes, fingerprint });
      // 给 microtask 一点时间让 postMessage 走完
      await Promise.resolve();
      handle.dispose();
      await expect(promise).rejects.toThrow('Worker parser disposed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dispose 后再调用 parse 立即拒绝', async () => {
    const handle = createWorkerParser()
    handle.dispose()
    const bytes = readFixtureBytes('cycling-gps.fit')
    const fingerprint = await computeFingerprint(bytes)
    await expect(
      handle.parse({ fileName: 'after-dispose.fit', bytes, fingerprint }),
    ).rejects.toThrow('Worker parser already disposed')
  });
});
