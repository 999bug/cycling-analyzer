import { useParams } from 'react-router-dom'

/**
 * 活动详情页面。
 * 后续展示该活动的路线地图与数据图表。
 */
function ActivityDetailPage() {
  const { id } = useParams()

  return (
    <>
      <h1>活动详情 #{id}</h1>
      <p>功能开发中：后续展示该活动的路线地图与数据图表。</p>
    </>
  )
}

export default ActivityDetailPage
