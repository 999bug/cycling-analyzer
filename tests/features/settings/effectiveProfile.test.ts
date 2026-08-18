/**
 * 训练配置随源测试（规格 §5.6）：
 * author → 快照 profile；快照缺失 → 空配置；local → 访客本地设置。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getEffectiveProfile } from '@/features/settings/effectiveProfile'
import { saveSettings, type UserProfile } from '@/features/settings/settings'
import type { SnapshotClient } from '@/storage/authorData/snapshotClient'

/** 构造指定 profile 行为的假快照客户端 */
function makeClient(profile: UserProfile | Error): SnapshotClient {
  return {
    getManifest: async () => ({ snapshotVersion: 1, author: 'Saul', generatedAt: '', activityCount: 0 }),
    getActivities: async () => [],
    getRecords: async () => [],
    getProfile: async () => {
      if (profile instanceof Error) {
        throw profile
      }
      return profile
    },
    getSegments: async () => [],
    getTracks: async () => ({ toleranceMeters: 10, tracks: [] }),
    getSegmentResults: async () => ({}),
    getRouteGroups: async () => [],
    getPowerRecords: async () => [],
  }
}

describe('getEffectiveProfile', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('作者模式返回快照 profile', async () => {
    const profile = await getEffectiveProfile('author', makeClient({ ftp: 280, maxHeartRate: 185 }))
    expect(profile).toEqual({ ftp: 280, maxHeartRate: 185 })
  })

  it('快照 profile 缺失时回退空配置', async () => {
    const profile = await getEffectiveProfile('author', makeClient(new Error('HTTP 404')))
    expect(profile).toEqual({})
  })

  it('本地模式返回访客自己的设置', async () => {
    await saveSettings({ profile: { ftp: 250, weightKg: 70 } })
    const profile = await getEffectiveProfile('local')
    expect(profile.ftp).toBe(250)
    expect(profile.weightKg).toBe(70)
  })
})
