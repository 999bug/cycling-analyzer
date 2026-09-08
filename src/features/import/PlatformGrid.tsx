/**
 * 导入向导第 1 步内容（选择方式）。
 *
 * 双路径入口：
 * - 直接导入（置顶两张高亮卡片）：已有整理好的 FIT 文件夹或单个文件的用户，
 *   点击后由父组件打开系统选择器并跳到导入步骤；
 * - 按平台引导：还没导出过的用户先选平台，进入第 2 步查看导出指引。
 */
import { PLATFORM_GUIDES, type PlatformGuide } from './platformGuides';

interface PlatformGridProps {
  /** 点击「导入文件夹」卡片（父组件跳转导入步骤并打开目录选择器） */
  onDirectFolder: () => void;

  /** 点击「导入单个文件」卡片（父组件打开文件选择器） */
  onDirectFile: () => void;

  /** 选中平台（进入第 2 步指引） */
  onPlatformSelect: (guide: PlatformGuide) => void;

  /** 当前选中平台 id（返回第 1 步时保持高亮） */
  selectedId: string | null;
}

/** 导入向导第 1 步：直接导入入口 + 平台选择网格 */
function PlatformGrid({ onDirectFolder, onDirectFile, onPlatformSelect, selectedId }: PlatformGridProps) {
  return (
    <>
      <p className="import-wz__section-title">我已经有导出好的数据</p>
      <div className="import-direct">
        <button type="button" className="import-direct__card" onClick={onDirectFolder}>
          <span className="import-direct__icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </span>
          <span className="import-direct__text">
            <span className="import-direct__name">导入文件夹</span>
            <span className="import-direct__hint">
              已整理好的 FIT / GPX 文件夹（或佳明 / Strava 导出目录），批量导入
            </span>
          </span>
        </button>
        <button type="button" className="import-direct__card" onClick={onDirectFile}>
          <span className="import-direct__icon" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <span className="import-direct__text">
            <span className="import-direct__name">导入单个文件</span>
            <span className="import-direct__hint">单个 .fit / .fit.gz / .gpx / .zip，可填写标题</span>
          </span>
        </button>
      </div>

      <div className="import-wz__divider">
        <span>还没有导出？按平台一步步来</span>
      </div>
      <p className="import-wz__section-desc">选择你的骑行平台，我会告诉你怎么导出：</p>
      <div className="import-platform-grid">
        {PLATFORM_GUIDES.map((guide) => (
          <button
            key={guide.id}
            type="button"
            className={`import-platform-card${selectedId === guide.id ? ' import-platform-card--sel' : ''}`}
            onClick={() => onPlatformSelect(guide)}
          >
            <span className="import-platform-ico" style={{ backgroundColor: guide.color }} aria-hidden="true">
              {guide.initial}
            </span>
            <span className="import-platform-name">{guide.name}</span>
            <span className="import-platform-summary">{guide.summary}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export default PlatformGrid;
