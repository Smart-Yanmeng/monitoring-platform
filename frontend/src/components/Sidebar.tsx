import { NavLink } from 'react-router-dom'
import type { Menu } from '../menu/types'
import type { ReactElement, ReactNode } from 'react'

// ── 线性图标（lucide 风格，currentColor 跟随文字颜色） ──
function SvgIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function VideoIcon() {
  return (
    <SvgIcon>
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    </SvgIcon>
  )
}

function DashboardIcon() {
  return (
    <SvgIcon>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </SvgIcon>
  )
}

function UsersIcon() {
  return (
    <SvgIcon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </SvgIcon>
  )
}

function BellIcon() {
  return (
    <SvgIcon>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </SvgIcon>
  )
}

function TrashIcon() {
  return (
    <SvgIcon>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </SvgIcon>
  )
}

function DotIcon() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="4" />
    </SvgIcon>
  )
}

// 按路径匹配内置图标；未匹配到的自定义菜单回退到其 icon 字段
const ICON_BY_PATH: Record<string, () => ReactElement> = {
  '/': VideoIcon,
  '/dashboard': DashboardIcon,
  '/users': UsersIcon,
  '/alarms': BellIcon,
  '/recycle': TrashIcon,
}

export default function Sidebar({ menus }: { menus: Menu[] }) {
  const roots = menus
    .filter((m) => m.parentId === null)
    .sort((a, b) => a.order - b.order)
  const childrenOf = (id: string) =>
    menus.filter((m) => m.parentId === id).sort((a, b) => a.order - b.order)

  const renderIcon = (m: Menu): ReactElement => {
    const Icon = ICON_BY_PATH[m.path]
    return Icon ? <Icon /> : <DotIcon />
  }

  return (
    <aside className="sidebar">
      <div className="brand">监控平台</div>
      <nav>
        {roots.map((m) => (
          <div key={m.id} className="nav-group">
            <NavLink to={m.path} end={m.path === '/'} className="nav-item">
              <span className="nav-icon">{renderIcon(m)}</span>
              <span>{m.name}</span>
            </NavLink>
            {childrenOf(m.id).map((c) => (
              <NavLink key={c.id} to={c.path} className="nav-subitem">
                <span className="nav-icon">{renderIcon(c)}</span>
                <span>{c.name}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
