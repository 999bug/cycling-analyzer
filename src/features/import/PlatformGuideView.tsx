/**
 * 导入向导第 2 步内容（平台导出指引）。
 *
 * 按所选平台渲染指引：标准流程用有序列表（steps），
 * 无单一标准流程的平台（行者）用多路径卡片（paths）。
 * 数据来源 platformGuides.ts，与云端教程同源维护。
 */
import { TUTORIAL_URL, type PlatformGuide } from './platformGuides';

interface PlatformGuideViewProps {
  /** 当前平台指引 */
  guide: PlatformGuide;

  /** 「我已拿到导出文件」→ 进入第 3 步导入 */
  onProceed: () => void;

  /** 返回第 1 步重选平台 */
  onBack: () => void;
}

/** 导入向导第 2 步：平台导出指引 */
function PlatformGuideView({ guide, onProceed, onBack }: PlatformGuideViewProps) {
  return (
    <>
      <div className="import-guide__head">
        <span className="import-platform-ico import-guide__ico" style={{ backgroundColor: guide.color }} aria-hidden="true">
          {guide.initial}
        </span>
        <span>
          <span className="import-guide__title">{guide.name} 导出指引</span>
          <span className="import-guide__meta">{guide.meta}</span>
        </span>
      </div>

      <div className="import-guide__tags">
        {guide.tags.map((tag) => (
          <span
            key={tag.text}
            className={`import-guide__tag${tag.tone === 'positive' ? ' import-guide__tag--positive' : ''}`}
          >
            {tag.text}
          </span>
        ))}
      </div>

      {guide.steps && (
        <ol className="import-guide__steps">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {guide.paths && (
        <div className="import-guide__paths">
          {guide.paths.map((path) => (
            <div key={path.title} className="import-guide__path">
              <span className="import-guide__path-title">{path.title}</span>
              <span className="import-guide__path-detail">{path.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* 图文教程外链：锚点与平台 id 一致，新标签页直达对应章节（含界面截图） */}
      <a
        className="import-wz__tutorial"
        href={`${TUTORIAL_URL}#${guide.id}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        查看「{guide.name}」图文教程（含界面截图）
      </a>

      <div className="import-guide__actions">
        <button type="button" className="import-wz__btn" onClick={onBack}>
          返回重选平台
        </button>
        <button type="button" className="import-wz__btn import-wz__btn--primary" onClick={onProceed}>
          我已拿到导出文件，进入导入
        </button>
      </div>
    </>
  );
}

export default PlatformGuideView;
