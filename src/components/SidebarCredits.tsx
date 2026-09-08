/**
 * 侧边栏致谢区块。
 *
 * 全站常驻（作者数据 / 我的数据两种源下均显示）：感谢参与测试与使用的骑友。
 * 名单统一由 acknowledgmentsData.ts 维护（增删成员只改该文件），
 * 完整区块见更新日志页底部，「更多」链接直达。
 * 徽章悬停显示成员贡献说明，带主页链接的成员昵称可点击。
 */
import { Link } from 'react-router-dom'
import {
  ACKNOWLEDGMENTS,
  type Acknowledgment,
} from '@/features/changelog/acknowledgmentsData'

/**
 * 侧边栏致谢区块（名单为空时不渲染，避免占位）。
 */
function SidebarCredits() {
  if (ACKNOWLEDGMENTS.length === 0) {
    return null
  }

  return (
    <section className="app-layout__credits" aria-label="致谢">
      <div className="app-layout__credits-header">
        <h2 className="app-layout__credits-title">致谢</h2>
        <Link
          className="app-layout__credits-more"
          to="/changelog"
          title="查看完整致谢名单"
        >
          更多
        </Link>
      </div>
      <ul className="app-layout__credits-list">
        {ACKNOWLEDGMENTS.map((person) => (
          <SidebarCreditBadge key={person.name} person={person} />
        ))}
      </ul>
    </section>
  )
}

/**
 * 单个致谢徽章：名字胶囊；带贡献说明时悬停提示，带主页链接时昵称可点击。
 *
 * @param person 致谢成员
 */
function SidebarCreditBadge({ person }: { person: Acknowledgment }) {
  if (person.url) {
    return (
      <li>
        <a
          className="app-layout__credits-badge"
          href={person.url}
          target="_blank"
          rel="noreferrer noopener"
          title={person.role}
        >
          {person.name}
        </a>
      </li>
    )
  }

  return (
    <li>
      <span className="app-layout__credits-badge" title={person.role}>
        {person.name}
      </span>
    </li>
  )
}

export default SidebarCredits
