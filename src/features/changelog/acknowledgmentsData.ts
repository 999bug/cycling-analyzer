/**
 * 致谢名单数据。
 *
 * 感谢参与测试与使用的骑友：每增加一位成员，在数组中追加一条即可，
 * 更新日志页底部的「致谢」区块自动展示（数组顺序即展示顺序）。
 */

/** 单条致谢条目。 */
export interface Acknowledgment {
  /** 昵称/名字（展示用，同时作为列表 key） */
  name: string

  /** 身份或贡献说明（可选，如「首批测试」「反馈了导入问题」） */
  role?: string

  /** 个人主页/博客/GitHub 链接（可选，有则昵称渲染为外链） */
  url?: string
}

/** 致谢名单（按展示顺序排列）。 */
export const ACKNOWLEDGMENTS: readonly Acknowledgment[] = [
  {
    name: 'qxlx',
    role: '提供网站名「骑了么」，贡献了许多点子与网站规划',
  },
  {
    name: 'Menghs',
    role: '贡献了许多点子与网站规划',
  },
  {
    name: 'Wesley',
    role: '反馈了 GPX 导入与行者记录不准的问题',
  }
];
