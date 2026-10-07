import { useEffect, useState } from 'react'
import type { Menu } from './types'

const STORAGE_KEY = 'monitoring.menus'

// 内置菜单：以代码为准（覆盖同名 id 的本地存储项），自定义菜单原样保留
const BUILTIN_MENUS: Menu[] = [
  { id: 'm-video', name: '视频监控', path: '/', icon: '📹', parentId: null, order: 1 },
  { id: 'm-dashboard', name: '仪表盘', path: '/dashboard', icon: '📊', parentId: null, order: 2 },
  { id: 'm-users', name: '人员管理', path: '/users', icon: '👤', parentId: null, order: 3 },
  { id: 'm-alarms', name: '报警管理', path: '/alarms', icon: '🚨', parentId: null, order: 4 },
  { id: 'm-recycle', name: '回收站管理', path: '/recycle', icon: '🗑️', parentId: null, order: 5 },
  { id: 'm-regions', name: '地区管理', path: '/regions', icon: '📍', parentId: null, order: 6 },
  { id: 'm-devices', name: '设备管理', path: '/devices', icon: '🎥', parentId: null, order: 7 },
  { id: 'm-models', name: '模型管理', path: '/models', icon: '🧠', parentId: null, order: 8 },
  { id: 'm-ai-status', name: 'AI服务状态', path: '/ai-status', icon: '🤖', parentId: null, order: 9 },
  { id: 'm-video-detect', name: '视频识别', path: '/video-detect', icon: '🎬', parentId: null, order: 10 },
]

// 已从默认菜单移除的历史内置 id（加载时清除，避免残留）
const REMOVED_BUILTIN_IDS = new Set(['m-menu'])

function load(): Menu[] {
  let stored: Menu[] | null = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) stored = JSON.parse(raw) as Menu[]
  } catch {
    // 忽略解析错误，回退到内置菜单
  }
  if (!stored) return [...BUILTIN_MENUS]
  const byId = new Map(stored.map((m) => [m.id, m]))
  for (const id of REMOVED_BUILTIN_IDS) byId.delete(id)
  for (const b of BUILTIN_MENUS) byId.set(b.id, b)
  return [...byId.values()]
}

export function useMenus() {
  const [menus, setMenus] = useState<Menu[]>(load)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(menus))
  }, [menus])

  const addMenu = (m: Omit<Menu, 'id'>) =>
    setMenus((prev) => [...prev, { ...m, id: `m-${Date.now().toString(36)}` }])

  const updateMenu = (id: string, patch: Partial<Omit<Menu, 'id'>>) =>
    setMenus((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const removeMenu = (id: string) =>
    setMenus((prev) => {
      const target = prev.find((m) => m.id === id)
      const toRemove = new Set<string>([id])
      if (target && target.parentId === null) {
        prev.forEach((m) => m.parentId === id && toRemove.add(m.id))
      }
      return prev.filter((m) => !toRemove.has(m.id))
    })

  return { menus, addMenu, updateMenu, removeMenu }
}
