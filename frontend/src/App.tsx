import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import VideoWall from './pages/VideoWall'
import Dashboard from './pages/Dashboard'
import MenuManage from './pages/MenuManage'
import UserManage from './pages/UserManage'
import AlarmManage from './pages/AlarmManage'
import RecycleManage from './pages/RecycleManage'
import RegionManage from './pages/RegionManage'
import DeviceManage from './pages/DeviceManage'
import ModelManage from './pages/ModelManage'
import AiStatus from './pages/AiStatus'
import VideoDetect from './pages/VideoDetect'
import Login from './pages/Login'
import Placeholder from './pages/Placeholder'
import { useMenus } from './menu/useMenus'
import { useAuth } from './authContext'

export default function App() {
  const { menus, addMenu, updateMenu, removeMenu } = useMenus()
  const { token, me, booted, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => {
    signOut()
    navigate('/login')
  }

  // 登录/注册页为独立全屏页面，不套用侧边栏布局
  if (location.pathname === '/login') {
    return <Login />
  }

  // 认证检查完成前不渲染，避免未登录内容闪现
  if (!booted) {
    return null
  }
  // 无 token 才跳转登录；有 token 但用户信息还在加载时显示空屏，避免登录后死循环
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!me) {
    return null
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
            <Route path="/regions" element={<RegionManage />} />
            <Route path="/devices" element={<DeviceManage />} />
            <Route path="/models" element={<ModelManage />} />
            <Route path="/ai-status" element={<AiStatus />} />
            <Route path="/video-detect" element={<VideoDetect />} />
            <Route path="*" element={<Placeholder />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
