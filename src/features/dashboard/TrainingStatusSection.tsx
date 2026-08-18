/**
 * 训练状态区块（规格 §39 P2）：Fitness（CTL）/ Fatigue（ATL）/ Form（TSB）
 * 当前值卡片 + 近 90 天负荷趋势图。
 *
 * 数据流：设置（FTP）→ 历史活动 NP 回填（幂等）→ 摘要聚合每日 TSS →
 * EWMA 递推 CTL/ATL。依赖 FTP 与功率数据（规格 §26 不伪造）：
 * 无 FTP 显示设置引导，无功率数据显示导入提示。
 */
import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { getSettings } from '@/features/settings/settings'
import { backfillNormalizedPower } from '@/features/analysis/backfillNormalizedPower'
import {
  buildDailyTss,
  buildTrainingStatus,
  type TrainingStatusPoint,
} from '@/features/analysis/trainingStatus'
import { useImportStore } from '@/stores/importStore'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import '@/features/dashboard/TrainingStatusSection.css'

/** 本地库仓库（NP 回填是写操作，仅本地源执行） */
const localRepository = new DexieActivityRepository(db)

/** 趋势图高度（px） */
const CHART_HEIGHT = 240

/** 测试环境固定初始尺寸（jsdom 无布局测量，ResizeObserver 不可用） */
const INITIAL_DIMENSION = { width: 800, height: CHART_HEIGHT }

/** 轴刻度样式（复用全局 CSS 变量） */
const TICK_STYLE = { fill: 'var(--text-secondary)', fontSize: 12 }

/** Tooltip 内容样式（深色） */
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
}

/** CTL/ATL/TSB 线条颜色（与训练区间色阶同色系） */
const LINE_COLORS = { ctl: '#4f8cff', atl: '#ff453a', tsb: '#34c759' } as const

/** 加载状态机 */
type LoadState = 'loading' | 'noFtp' | 'noData' | 'ready' | 'error'

/** 状态文案映射（ready 不显示文案） */
const STATE_MESSAGES: Record<Exclude<LoadState, 'ready'>, string> = {
  loading: '训练状态计算中…',
  noFtp: '在设置中配置 FTP 后可查看训练状态',
  noData: '暂无功率数据，导入含功率计的骑行后展示训练状态',
  error: '训练状态加载失败',
}

/**
 * 训练状态区块。
 */
function TrainingStatusSection() {
  const [state, setState] = useState<LoadState>('loading')
  const [points, setPoints] = useState<readonly TrainingStatusPoint[]>([])
  // 订阅导入结果：数据导入完成后自动刷新（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const repository = useActivityRepository()
  // 数据源（NP 回填仅本地源执行）
  const source = useDataSourceStore(selectEffectiveSource)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await getSettings()
        const ftp = settings.profile.ftp
        if (cancelled) {
          return
        }
        if (ftp === undefined || ftp <= 0) {
          setState('noFtp')
          return
        }
        // 历史活动 NP 回填（幂等，无待回填时秒过），随后基于摘要直接聚合；
        // 回填是写操作，仅本地源执行（快照摘要构建时已含 NP）
        if (source === 'local') {
          await backfillNormalizedPower(localRepository)
        }
        const summaries = await repository.listAllSummaries()
        if (cancelled) {
          return
        }
        const status = buildTrainingStatus(buildDailyTss(summaries, ftp))
        if (status.length === 0) {
          setState('noData')
          return
        }
        setPoints(status)
        setState('ready')
      } catch (err: unknown) {
        if (!cancelled) {
          setState('error')
        }
        console.error('Failed to load training status', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [importSummary, source, repository])

  return (
    <section className="training-status" aria-label="训练状态">
      <h2 className="training-status__title">训练状态</h2>
      {state !== 'ready' ? (
        <p className="training-status__message">{STATE_MESSAGES[state]}</p>
      ) : (
        <>
          <StatusCards current={points[points.length - 1]} />
          <div className="training-status__plot" role="img" aria-label="训练负荷趋势图">
            <ResponsiveContainer
              width="100%"
              height={CHART_HEIGHT}
              initialDimension={INITIAL_DIMENSION}
            >
              <RechartsLineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) => date.slice(5)}
                  tick={TICK_STYLE}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  minTickGap={32}
                />
                <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [
                    Math.round(Number(value)),
                    name === 'ctl' ? '体能' : name === 'atl' ? '疲劳' : '状态',
                  ]}
                  labelFormatter={(label) => `日期 ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="ctl"
                  stroke={LINE_COLORS.ctl}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="atl"
                  stroke={LINE_COLORS.atl}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="tsb"
                  stroke={LINE_COLORS.tsb}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>
          <div className="training-status__legend">
            <span style={{ color: LINE_COLORS.ctl }}>— 体能（CTL）</span>
            <span style={{ color: LINE_COLORS.atl }}>— 疲劳（ATL）</span>
            <span style={{ color: LINE_COLORS.tsb }}>— 状态（TSB）</span>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * 当前值卡片：体能 / 疲劳 / 状态（TSB 带正负号着色）。
 *
 * @param current 最新一天的训练状态点
 */
function StatusCards({ current }: { current: TrainingStatusPoint }) {
  const cards = [
    { label: '体能（CTL）', value: String(Math.round(current.ctl)), className: '' },
    { label: '疲劳（ATL）', value: String(Math.round(current.atl)), className: '' },
    {
      label: '状态（TSB）',
      value: `${current.tsb >= 0 ? '+' : ''}${Math.round(current.tsb)}`,
      className:
        current.tsb >= 0
          ? 'training-status__value--positive'
          : 'training-status__value--negative',
    },
  ]
  return (
    <div className="training-status__cards">
      {cards.map((card) => (
        <div key={card.label} className="training-status__card">
          <span className={`training-status__value ${card.className}`}>{card.value}</span>
          <span className="training-status__label">{card.label}</span>
        </div>
      ))}
    </div>
  )
}

export default TrainingStatusSection
