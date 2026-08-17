/**
 * 个人纪录区块（规格 §39 P2）：骑行纪录 + 功率纪录卡片墙。
 *
 * 骑行纪录（最远距离/最长时长/最多爬升）来自活动摘要，即时可显示；
 * 功率纪录（5s/1min/5min/20min 最佳平均功率）需扫描全部逐点数据，
 * 计算期间显示提示文案，无功率数据时同样显示提示（不伪造，规格 §25）。
 * 每张卡片链接到达成纪录的活动详情页。
 */
import { Link } from 'react-router-dom'
import { formatDate, formatDistance, formatDuration, formatElevation } from '@/utils/format'
import type { PowerRecordEntry, RideRecordEntry } from '@/features/records/personalRecords'
import '@/features/records/personalRecords.css'

/**
 * 个人纪录区块 props。
 */
export interface RecordCardsProps {
  /** 骑行纪录（buildRideRecords 输出） */
  rideRecords: readonly RideRecordEntry[]

  /** 功率纪录（null = 计算中；空数组 = 无功率数据） */
  powerRecords: readonly PowerRecordEntry[] | null

  /** 功率纪录扫描是否失败（true 时显示失败提示） */
  powerRecordsFailed?: boolean
}

/** 骑行纪录标签映射 */
const RIDE_RECORD_LABELS: Record<RideRecordEntry['key'], string> = {
  distance: '最远距离',
  duration: '最长时长',
  elevationGain: '最多爬升',
}

/** 功率纪录标签映射（秒 → 中文时长） */
const POWER_RECORD_LABELS: Record<number, string> = {
  5: '5 秒功率',
  60: '1 分钟功率',
  300: '5 分钟功率',
  1200: '20 分钟功率',
}

/**
 * 统一卡片数据项。
 */
interface RecordCardItem {
  /** 唯一键 */
  key: string

  /** 纪录名称 */
  label: string

  /** 格式化后的纪录值 */
  value: string

  /** 达成活动 ID */
  activityId: string

  /** 达成活动开始时间（ISO 8601） */
  startTime: string
}

/**
 * 骑行纪录值格式化（单位与领域模型一致）。
 *
 * @param entry 骑行纪录
 * @returns 格式化展示值
 */
function formatRideValue(entry: RideRecordEntry): string {
  switch (entry.key) {
    case 'distance':
      return formatDistance(entry.value)
    case 'duration':
      return formatDuration(entry.value)
    case 'elevationGain':
      return formatElevation(entry.value)
  }
}

/**
 * 个人纪录区块。
 *
 * @param props 组件参数
 */
function RecordCards({ rideRecords, powerRecords, powerRecordsFailed = false }: RecordCardsProps) {
  const rideItems: RecordCardItem[] = rideRecords.map((entry) => ({
    key: entry.key,
    label: RIDE_RECORD_LABELS[entry.key],
    value: formatRideValue(entry),
    activityId: entry.activityId,
    startTime: entry.startTime,
  }))
  const powerItems: RecordCardItem[] = (powerRecords ?? []).map((entry) => ({
    key: `power-${entry.duration}`,
    label: POWER_RECORD_LABELS[entry.duration] ?? `${entry.duration} 秒功率`,
    value: `${Math.round(entry.power)} W`,
    activityId: entry.activityId,
    startTime: entry.startTime,
  }))

  return (
    <section className="personal-records" aria-label="个人纪录">
      <h2 className="personal-records__title">个人纪录</h2>
      <div className="personal-records__grid">
        {rideItems.map((item) => (
          <RecordCard key={item.key} item={item} />
        ))}
        {powerRecordsFailed ? (
          <p className="personal-records__hint">功率纪录加载失败</p>
        ) : powerRecords === null ? (
          <p className="personal-records__hint">功率纪录计算中…</p>
        ) : powerItems.length === 0 ? (
          <p className="personal-records__hint">暂无功率数据，导入含功率计的骑行后展示功率纪录</p>
        ) : (
          powerItems.map((item) => <RecordCard key={item.key} item={item} />)
        )}
      </div>
    </section>
  )
}

/**
 * 单张纪录卡片：数值 + 名称 + 达成日期，点击跳转活动详情。
 *
 * @param item 卡片数据
 */
function RecordCard({ item }: { item: RecordCardItem }) {
  return (
    <Link className="record-card" to={`/activities/${item.activityId}`}>
      <span className="record-card__value">{item.value}</span>
      <span className="record-card__label">{item.label}</span>
      <span className="record-card__date">{formatDate(item.startTime)}</span>
    </Link>
  )
}

export default RecordCards
