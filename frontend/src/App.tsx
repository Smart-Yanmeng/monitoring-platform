import { useEffect, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import VideoWall from './pages/VideoWall'
import Dashboard from './pages/Dashboard'
import MenuManage from './pages/MenuManage'
import UserManage from './pages/UserManage'
import AlarmManage from './pages/AlarmManage'
import RecycleManage from './pages/RecycleManage'
import Login from './pages/Login'
import Placeholder from './pages/Placeholder'
import { useMenus } from './menu/useMenus'
import { clearToken, fetchMe, type Me } from './auth'

export default function App() {
  const { menus, addMenu, updateMenu, removeMenu } = useMenus()
  const [me, setMe] = useState<Me | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    fetchMe().then((m) => {
      if (alive) setMe(m)
    })
    return () => {
      alive = false
    }
  }, [location.pathname])

  const handleLogout = () => {
    clearToken()
    setMe(null)
    navigate('/login')
  }

  // 登录/注册页为独立全屏页面，不套用侧边栏布局
  if (location.pathname === '/login') {
    return <Login />
  }

  const pageTitle =
    menus.find((m) => m.path === location.pathname)?.name ?? '监控平台'

  return (
    <div className="layout">
      <Sidebar menus={menus} />
      <div className="main-area">
        <Topbar title={pageTitle} me={me} onLogout={handleLogout} />
        <main className="content">
          <Routes>
            <Route path="/" element={<VideoWall />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route
              path="/menu"
              element={
                <MenuManage
                  menus={menus}
                  addMenu={addMenu}
                  updateMenu={updateMenu}
                  removeMenu={removeMenu}
                />
              }
            />
            <Route path="/users" element={<UserManage />} />
            <Route path="/alarms" element={<AlarmManage />} />
            <Route path="/recycle" element={<RecycleManage />} />
            <Route path="*" element={<Placeholder />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
