/**
 * 作者快照客户端测试：路径拼接（含 BASE_URL）、会话内缓存、错误语义。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotClient } from '@/storage/authorData/snapshotClient'

/**
 * 构造 fetch mock：路由表路径 → 响应数据；未命中路径返回 404。
 *
 * @param routes 路径后缀 → JSON 数据
 */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const hit = Object.entries(routes).find(([path]) => url.endsWith(path))
    if (hit === undefined) {
      return new Response('not found', { status: 404 })
    }
    return new Response(JSON.stringify(hit[1]), { status: 200 })
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

describe('snapshotClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按 BASE_URL 拼接快照路径', async () => {
    const { calls } = stubFetch({ 'author-data/manifest.json': { snapshotVersion: 1 } })
    const client = createSnapshotClient()
    await client.getManifest()
    // vitest 环境 BASE_URL 为 '/'（vite.config：仅 build 时为 /cycling-analyzer/）
    expect(calls).toEqual(['/author-data/manifest.json'])
  })

  it('同一路径会话内只拉取一次（缓存）', async () => {
    const { impl } = stubFetch({ 'author-data/activities.json': [] })
    const client = createSnapshotClient()
    await client.getActivities()
    await client.getActivities()
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it('HTTP 非 200 时抛错（消息含路径与状态码）', async () => {
    stubFetch({})
    const client = createSnapshotClient()
    await expect(client.getManifest()).rejects.toThrow(/manifest\.json.*404/)
  })

  it('getRecords 按活动 ID 拼路径并返回 records 数组', async () => {
    stubFetch({
      'author-data/records/abc.json': { activityId: 'abc', records: [{ timestamp: 1 }] },
    })
    const client = createSnapshotClient()
    const records = await client.getRecords('abc')
    expect(records).toEqual([{ timestamp: 1 }])
  })

  it('不同客户端实例缓存互不影响', async () => {
    const { impl } = stubFetch({ 'author-data/manifest.json': { snapshotVersion: 1 } })
    await createSnapshotClient().getManifest()
    await createSnapshotClient().getManifest()
    expect(impl).toHaveBeenCalledTimes(2)
  })
})
