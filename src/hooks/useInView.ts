/**
 * 视口进入检测 hook（GPX 导入卡死修复：迷你地图懒加载）。
 *
 * IntersectionObserver rootMargin 预加载 200px：卡片接近可视区即提前挂载
 * 地图，滚动到位时已就绪。jsdom/旧浏览器无 IntersectionObserver 时
 * 直接返回 true（立即渲染，退化为现状）。
 */
import { useEffect, useRef, useState } from 'react'

/**
 * 监听元素进入视口。
 *
 * @returns [ref, inView] 元素引用与是否已进入视口（一次性，进入后不再翻转）
 */
export function useInView(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  // 环境探测放初始化器（渲染期一次）：无 IntersectionObserver 直接视为已可见，
  // 避免在 effect 中 setState（react-hooks/set-state-in-effect）
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (inView) {
      return
    }
    const element = ref.current
    if (element === null) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [inView])

  return [ref, inView]
}
