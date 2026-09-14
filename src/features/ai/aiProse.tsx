/**
 * AI 正文渲染（v5）：把模型输出里的 **加粗** 标记渲染成高亮 strong，
 * 其余文本原样保留（含换行）。提示词要求模型把关键数字用 **标记**。
 */
import type { JSX } from 'react'

/**
 * 渲染带加粗标记的 AI 正文。
 *
 * @param text 模型输出文本（可含 **加粗** 标记）
 * @returns JSX 段落内容
 */
export function renderAiProse(text: string): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return part
      })}
    </>
  )
}
