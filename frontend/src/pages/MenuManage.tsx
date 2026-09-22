import { useState } from 'react'
import type { Menu } from '../menu/types'

type Props = {
  menus: Menu[]
  addMenu: (m: Omit<Menu, 'id'>) => void
  updateMenu: (id: string, patch: Partial<Omit<Menu, 'id'>>) => void
  removeMenu: (id: string) => void
}

export default function MenuManage({ menus, addMenu, updateMenu, removeMenu }: Props) {
  const [editing, setEditing] = useState<Menu | null>(null)
  const [form, setForm] = useState({
    name: '',
    path: '',
    icon: '',
    parentId: '',
    order: '99',
  })

  const roots = menus.filter((m) => m.parentId === null)

  const reset = () => {
    setEditing(null)
    setForm({ name: '', path: '', icon: '', parentId: '', order: '99' })
  }

  const startEdit = (m: Menu) => {
    setEditing(m)
    setForm({
      name: m.name,
      path: m.path,
      icon: m.icon,
      parentId: m.parentId ?? '',
      order: String(m.order),
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return
    const payload = {
      name,
      path: form.path.trim() || '/',
      icon: form.icon.trim(),
      parentId: form.parentId || null,
      order: Number(form.order) || 99,
    }
    if (editing) updateMenu(editing.id, payload)
    else addMenu(payload)
    reset()
  }

  const sorted = [...menus].sort((a, b) => a.order - b.order)

  return (
    <div>
      <h2>菜单管理</h2>
      <p className="detail">菜单定义保存在浏览器 localStorage，仅前端生效（无需后端）。</p>

      <div className="card">
        <form className="menu-form" onSubmit={submit}>
          <input
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="路径 (如 /logs)"
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
          />
          <input
            placeholder="图标 (emoji)"
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
          />
          <select
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          >
            <option value="">顶级菜单</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            placeholder="排序"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: e.target.value })}
            style={{ width: 80 }}
          />
          <button type="submit">{editing ? '保存' : '新增'}</button>
          {editing && (
            <button type="button" onClick={reset}>
              取消
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <table className="menu-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>路径</th>
              <th>图标</th>
              <th>父级</th>
              <th>排序</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.path}</td>
                <td>{m.icon}</td>
                <td>
                  {m.parentId
                    ? menus.find((x) => x.id === m.parentId)?.name ?? m.parentId
                    : '—'}
                </td>
                <td>{m.order}</td>
                <td>
                  <button onClick={() => startEdit(m)}>编辑</button>
                  <button className="danger" onClick={() => removeMenu(m.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
