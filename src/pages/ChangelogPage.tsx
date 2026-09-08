/**
 * 版本更新日志页面。
 *
 * 时间线展示各版本新增功能（倒序，最新在前）；
 * 当前运行版本（__APP_VERSION__）高亮「当前版本」徽章，
 * 帮助用户快速了解每次更新了什么（用户需求：一目了然）。
 * 底部附「致谢」区块，感谢参与测试与使用的骑友（名单由 acknowledgmentsData 维护）。
 */
import {
  ACKNOWLEDGMENTS,
  type Acknowledgment,
} from '@/features/changelog/acknowledgmentsData'
import { CHANGELOG, type ChangelogEntry } from '@/features/changelog/changelogData'
import '@/pages/ChangelogPage.css'

/** 当前应用版本（vite define 注入 package.json version）。 */
const CURRENT_VERSION = __APP_VERSION__

/**
 * 版本更新日志页面。
 */
function ChangelogPage() {
  return (
    <>
      <h1>更新日志</h1>
      <p className="changelog-page__intro">
        每个版本新增了什么功能，按时间从近到远排列；侧边栏底部的版本号也可点击直达本页。
      </p>
      <ol className="changelog-timeline" aria-label="版本更新时间线">
        {CHANGELOG.map((entry) => (
          <ChangelogItem key={entry.version} entry={entry} />
        ))}
      </ol>
      <AcknowledgmentsSection />
    </>
  )
}

/**
 * 单个版本条目：版本徽章 + 日期 + 功能列表。
 *
 * @param entry 更新日志条目
 */
function ChangelogItem({ entry }: { entry: ChangelogEntry }) {
  const isCurrent = entry.version === CURRENT_VERSION
  return (
    <li className="changelog-item">
      <div className="changelog-item__header">
        <span
          className={
            'changelog-item__version' +
            (isCurrent ? ' changelog-item__version--current' : '')
          }
        >
          v{entry.version}
          {isCurrent && <span className="changelog-item__badge">当前版本</span>}
        </span>
        <time className="changelog-item__date" dateTime={entry.date}>
          {entry.date}
        </time>
      </div>
      <ul className="changelog-item__features">
        {entry.features.map((feature) => (
          <li key={feature} className="changelog-item__feature">
            {feature}
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * 致谢区块：感谢参与测试与使用的骑友。
 * 名单统一维护在 acknowledgmentsData.ts，带 url 的成员昵称渲染为外链。
 */
function AcknowledgmentsSection() {
  return (
    <section className="changelog-acknowledgments" aria-label="致谢">
      <h2 className="changelog-acknowledgments__title">致谢</h2>
      <p className="changelog-acknowledgments__intro">
        感谢每一位参与测试与使用的骑友，你们的反馈让这个网站越来越好。
      </p>
      <ul className="changelog-acknowledgments__list">
        {ACKNOWLEDGMENTS.map((person) => (
          <AcknowledgmentBadge key={person.name} person={person} />
        ))}
      </ul>
    </section>
  )
}

/**
 * 单个致谢徽章：昵称 + 可选身份说明，带 url 时昵称可点击。
 *
 * @param person 致谢成员
 */
function AcknowledgmentBadge({ person }: { person: Acknowledgment }) {
  return (
    <li className="changelog-acknowledgments__item">
      {person.url ? (
        <a
          className="changelog-acknowledgments__name"
          href={person.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {person.name}
        </a>
      ) : (
        <span className="changelog-acknowledgments__name">{person.name}</span>
      )}
      {person.role && <span className="changelog-acknowledgments__role">{person.role}</span>}
    </li>
  )
}

export default ChangelogPage
