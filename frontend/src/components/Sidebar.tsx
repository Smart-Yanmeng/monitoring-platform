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

function MapIcon() {
  return (
    <SvgIcon>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </SvgIcon>
  )
}

function DeviceIcon() {
  return (
    <SvgIcon>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </SvgIcon>
  )
}

function ModelIcon() {
  return (
    <SvgIcon>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </SvgIcon>
  )
}

function PulseIcon() {
  return (
    <SvgIcon>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </SvgIcon>
  )
}

function ScanIcon() {
  return (
    <SvgIcon>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="1" />
      <path d="M18.9 12.3a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.89 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.89 0" />
    </SvgIcon>
  )
}

function MenuIcon() {
  return (
    <SvgIcon>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
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
  '/regions': MapIcon,
  '/devices': DeviceIcon,
  '/models': ModelIcon,
  '/ai-status': PulseIcon,
  '/video-detect': ScanIcon,
  '/menu': MenuIcon,
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
