/**
 * 本地数据迁移进度条（全局唯一实例，挂 AppLayout 布局根，v5 存储模型升级）。
 *
 * 触发链路：挂载后延迟到首屏数据加载完，再启动后台分批迁移
 * （runRecordsMigration，每批让出主线程，UI 全程可交互）。
 * 迁移期间显示进度横幅；完成后自动刷新页面一次（刷新后旧读取路径
 * 全部走新表）。隐私口径：文案明确「仅在本浏览器内整理，不上传」。
 *
 * 多标签页：另一标签持心跳锁时本标签静默轮询其完成状态，完成同样刷新。
 * 失败不自动刷新（避免刷新循环），显示错误文案由用户手动重试。
 */
import { useEffect, useRef, useState } from 'react'
import { db } from '@/storage/db'
import { MIGRATION_SETTINGS_KEY, runRecordsMigration, type MigrationProgress } from '@/storage/recordsMigration'
import './MigrationBanner.css'

/** 完成后自动刷新延迟（毫秒）：给「迁移完成」文案留出可读时间 */
const RELOAD_DELAY_MS = 1500

/** busy 轮询间隔（毫秒） */
const BUSY_POLL_INTERVAL_MS = 2000

/** busy 轮询放弃上限（毫秒）：另一标签迁移超 10 分钟视为异常，静默退出 */
const BUSY_POLL_GIVE_UP_MS = 10 * 60 * 1000

/** 组件内部状态 */
type BannerPhase =
  | { kind: 'idle' }
  | { kind: 'running'; progress: MigrationProgress }
  | { kind: 'finishing' }
  | { kind: 'error' }

/** 组件属性（迁移逻辑可注入，测试用） */
interface MigrationBannerProps {
  /** 迁移执行器（默认真实现；测试注入受控桩） */
  runMigration?: (
    onProgress: (progress: MigrationProgress) => void,
  ) => Promise<'done' | 'already-done' | 'busy'>;

  /** 完成后是否自动刷新（默认 true；测试关闭避免 jsdom 导航） */
  autoReload?: boolean;
}

function MigrationBanner({ runMigration, autoReload = true }: MigrationBannerProps) {
  const [phase, setPhase] = useState<BannerPhase>({ kind: 'idle' })
  // 组件从渲染树卸载时终止回调（AppLayout 单例挂载，防御性兜底）
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    const runner = runMigration ?? defaultRunner

    // busy（另一标签在迁移）：轮询 settings 状态，其完成后本标签同样刷新
    async function pollBusy(): Promise<void> {
      const startedAt = Date.now()
      for (;;) {
        if (disposedRef.current) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, BUSY_POLL_INTERVAL_MS))
        const entry = await db.settings.get(MIGRATION_SETTINGS_KEY)
        const status = (entry?.value as { status?: string } | undefined)?.status
        if (status === 'done') {
          if (disposedRef.current) {
            return
          }
          setPhase({ kind: 'finishing' })
          if (autoReload) {
            window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
          }
          return
        }
        if (Date.now() - startedAt > BUSY_POLL_GIVE_UP_MS) {
          return
        }
      }
    }

    // 启动迁移：让首屏先渲染（idle 落一帧），进度经横幅展示
    const kickoff = window.setTimeout(() => {
      void runner((progress) => {
        if (!disposedRef.current) {
          setPhase({ kind: 'running', progress })
        }
      })
        .then((outcome) => {
          if (disposedRef.current) {
            return
          }
          if (outcome === 'busy') {
            void pollBusy()
            return
          }
          // 早已完成（上个会话已标记 done）：静默跳过，绝不刷新——
          // 否则每次启动都走「完成→刷新」分支，造成无限刷新循环
          if (outcome === 'already-done') {
            return
          }
          setPhase({ kind: 'finishing' })
          if (autoReload) {
            window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
          }
        })
        .catch(() => {
          if (!disposedRef.current) {
            setPhase({ kind: 'error' })
          }
        })
    }, 0)

    return () => {
      disposedRef.current = true
      window.clearTimeout(kickoff)
    }
    // 迁移整个应用生命周期只应启动一次，依赖留空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase.kind !== 'running' && phase.kind !== 'finishing' && phase.kind !== 'error') {
    return null
  }

  const percent =
    phase.kind === 'running' && phase.progress.total > 0
      ? Math.round((phase.progress.migrated / phase.progress.total) * 100)
      : phase.kind === 'finishing'
        ? 100
        : 0

  return (
    <aside className="migration-banner" role="status" aria-label="本地数据迁移进度">
      <div className="migration-banner__body">
        <p className="migration-banner__title">
          {phase.kind === 'error'
            ? '本地数据升级失败'
            : phase.kind === 'finishing'
              ? '本地数据升级完成，即将自动刷新…'
              : '正在升级本地数据存储…'}
        </p>
        {phase.kind === 'running' && (
          <>
            <div
              className="migration-banner__bar"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="migration-banner__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="migration-banner__desc">
              {phase.progress.migrated} / {phase.progress.total} · 数据仅在本浏览器内重新整理存储，不会上传到任何服务器
            </p>
          </>
        )}
        {phase.kind === 'error' && (
          <p className="migration-banner__desc">
            数据未受影响，稍后刷新页面将自动继续升级。
          </p>
        )}
      </div>
    </aside>
  )
}

/** 默认迁移执行器（真实现，绑定全局库单例） */
function defaultRunner(onProgress: (progress: MigrationProgress) => void) {
  return runRecordsMigration(db, onProgress)
}

export default MigrationBanner
