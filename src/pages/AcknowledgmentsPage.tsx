/**
 * 致谢页面。
 *
 * 完整展示参与测试与使用的骑友感谢名单，名单由 acknowledgmentsData.ts
 * 统一维护：每位成员一张卡片（首字母头像 + 昵称 + 贡献说明），带主页链接的
 * 昵称渲染为外链。名单本体抽为 AcknowledgmentList 供设置页「鸣谢」区块复用
 * （2.64.0 起鸣谢移入设置页，独立路由保留兼容旧链接）。
 * 数据源无关——作者数据 / 我的数据下均可见。
 */
import {
  ACKNOWLEDGMENTS,
  type Acknowledgment,
} from '@/features/changelog/acknowledgmentsData'
import '@/pages/AcknowledgmentsPage.css'

/**
 * 鸣谢名单：成员卡片列表，空名单时展示空态（设置页「鸣谢」区块复用）。
 */
export function AcknowledgmentList() {
  if (ACKNOWLEDGMENTS.length === 0) {
    return <p className="acknowledgments-page__empty">名单筹备中，敬请期待。</p>
  }
  return (
    <ul className="acknowledgments-page__list" aria-label="鸣谢名单">
      {ACKNOWLEDGMENTS.map((person) => (
        <AcknowledgmentCard key={person.name} person={person} />
      ))}
    </ul>
  )
}

/**
 * 致谢页面。
 */
function AcknowledgmentsPage() {
  return (
    <div className="acknowledgments-page">
      <h1>鸣谢</h1>
      <p className="acknowledgments-page__intro">
        感谢每一位参与「骑了么」测试的骑友，<br />
        感谢你们提供的每一次反馈、建议和 Bug。<br />
        因为你们，「骑了么」才能变得越来越好。
      </p>
      <AcknowledgmentList />
    </div>
  )
}

/**
 * 单张致谢卡片：首字母头像 + 昵称 + 贡献说明；带主页链接时昵称可点击。
 *
 * @param person 致谢成员
 */
function AcknowledgmentCard({ person }: { person: Acknowledgment }) {
  // 头像取名字首字符（中英文皆可），无实际头像图时作为视觉锚点
  const avatar = person.name.trim().charAt(0).toUpperCase()
  return (
    <li className="acknowledgments-card">
      <span className="acknowledgments-card__avatar" aria-hidden="true">
        {avatar}
      </span>
      <div className="acknowledgments-card__body">
        {person.url ? (
          <a
            className="acknowledgments-card__name"
            href={person.url}
            target="_blank"
            rel="noreferrer noopener"
            title="访问主页"
          >
            {person.name}
          </a>
        ) : (
          <span className="acknowledgments-card__name">{person.name}</span>
        )}
        {person.role && (
          <p className="acknowledgments-card__role">{person.role}</p>
        )}
      </div>
    </li>
  )
}

export default AcknowledgmentsPage
