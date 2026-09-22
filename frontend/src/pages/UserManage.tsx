import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getToken } from '../auth'

type User = { id: number; username: string; enabled: boolean; roles: string[] }

export default function UserManage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', roles: 'ROLE_USER' })

  const load = async () => {
    if (!getToken()) {
      navigate('/login')
      return
    }
    setError(null)
    const res = await api('/api/users')
    if (res.status === 401) {
      navigate('/login')
      return
    }
    if (res.status === 403) {
      setDenied(true)
      return
    }
    if (!res.ok) {
      setError('加载失败: ' + res.status)
      return
    }
    setDenied(false)
    setUsers(await res.json())
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const roles = form.roles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await api('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.trim(),
        password: form.password,
        roles,
      }),
    })
    if (res.ok) {
      setForm({ username: '', password: '', roles: 'ROLE_USER' })
      load()
    } else {
      setError('创建失败: ' + res.status)
    }
  }

  const remove = async (id: number) => {
    const res = await api('/api/users/' + id, { method: 'DELETE' })
    if (res.ok) load()
    else setError('删除失败: ' + res.status)
  }

  if (denied) {
    return (
      <div>
        <h2>人员管理</h2>
        <div className="card">
          <div className="detail" style={{ color: '#f85149' }}>
            无权访问：该接口需要 ROLE_ADMIN 角色（当前账号为 ROLE_USER）。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2>人员管理</h2>
      <p className="detail">接口需要 ROLE_ADMIN 角色；JWT 自动附加在请求头中。</p>
      {error && (
        <div className="detail" style={{ color: '#f85149' }}>
          {error}
        </div>
      )}

      <div className="card">
        <form className="menu-form" onSubmit={create}>
          <input
            placeholder="用户名"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            placeholder="密码"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <input
            placeholder="角色(逗号分隔, 如 ROLE_USER)"
            value={form.roles}
            onChange={(e) => setForm({ ...form, roles: e.target.value })}
          />
          <button type="submit">新增用户</button>
        </form>
      </div>

      <div className="card">
        <table className="menu-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>启用</th>
              <th>角色</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>{u.enabled ? '是' : '否'}</td>
                <td>{u.roles.join(', ')}</td>
                <td>
                  <button className="danger" onClick={() => remove(u.id)}>
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
