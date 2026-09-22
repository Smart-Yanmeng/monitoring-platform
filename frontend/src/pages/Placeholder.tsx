import { useLocation } from 'react-router-dom'

export default function Placeholder() {
  const { pathname } = useLocation()
  return (
    <div className="card">
      <h2>页面建设中</h2>
      <p className="detail">
        路径 <code>{pathname}</code> 暂未实现，可在「菜单管理」中维护菜单项。
      </p>
    </div>
  )
}
