import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Me } from '../auth'

type Props = {
  title: string
  me: Me | null
  onLogout: () => void
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export default function Topbar({ title, me, onLogout }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭菜单
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = me?.username.charAt(0).toUpperCase() ?? '?'

  return (
    <div className="topbar-wrap">
      <header className="topbar-island">
        <div className="topbar-left">
          <span className="topbar-dot" />
          <span className="topbar-title">{title}</span>
        </div>

        <div className="topbar-right">
          {me ? (
            <div className="topbar-user-wrap" ref={wrapRef}>
              <button
                className="topbar-user-btn"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="menu"
              >
                <span className="topbar-avatar">{initial}</span>
                <span className="topbar-name">{me.username}</span>
                <span className={open ? 'topbar-chevron open' : 'topbar-chevron'}>
                  <ChevronIcon />
                </span>
              </button>

              {open && (
                <div className="topbar-menu" role="menu">
                  <div className="topbar-menu-head">
                    <span className="topbar-avatar topbar-avatar-lg">{initial}</span>
                    <span className="topbar-menu-name">{me.username}</span>
                  </div>
                  <div className="topbar-menu-sep" />
                  <button
                    className="topbar-menu-item topbar-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false)
                      onLogout()
                    }}
                  >
                    <LogoutIcon />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="topbar-login-btn" onClick={() => navigate('/login')}>
              登录 / 注册
            </button>
          )}
        </div>
      </header>
    </div>
  )
}
