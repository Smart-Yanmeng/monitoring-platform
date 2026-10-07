import { useEffect, useState } from 'react'
import { api } from '../auth'
import { useAuth } from '../authContext'

type AiModel = {
  id: number
  name: string
  filePath: string
  type: string | null
  description: string | null
  active: boolean
  createdAt: string | null
}

export default function ModelManage() {
  const { me } = useAuth()
  const isAdmin = me?.authorities.includes('ROLE_ADMIN') ?? false
  const [list, setList] = useState<AiModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', filePath: '', type: '', description: '' })

  const load = async () => {
    const res = await api('/api/models')
    if (res.ok) setList(await res.json())
    else setError('加载失败: ' + res.status)
  }

  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setError(null)
    const res = await api('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setForm({ name: '', filePath: '', type: '', description: '' })
      load()
    } else {
      const d = await res.json().catch(() => null)
      setError(d?.error || '添加失败: ' + res.status)
    }
  }

  const activate = async (id: number) => {
    const res = await api('/api/models/' + id + '/activate', { method: 'PUT' })
    if (res.ok) load()
    else setError('启用失败: ' + res.status)
  }

  const remove = async (id: number) => {
    if (!confirm('确定删除该模型？')) return
    const res = await api('/api/models/' + id, { method: 'DELETE' })
    if (res.ok) load()
    else setError('删除失败: ' + res.status)
  }

  return (
    <div className="page">
      <h2>模型管理</h2>
      <p className="muted">注册多个 AI 模型，并选择当前启用的模型（AI 服务会自动加载启用中的模型）。</p>
      {error && <div className="error-text">{error}</div>}

      {isAdmin && (
        <div className="menu-form" style={{ marginBottom: '1rem' }}>
          <input
            placeholder="模型名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="权重路径，如 /opt/models/fight.pt"
            value={form.filePath}
            onChange={(e) => setForm({ ...form, filePath: e.target.value })}
          />
          <input
            placeholder="类型(可选)，如 fight"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          />
          <input
            placeholder="描述(可选)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <button type="button" onClick={add}>
            添加模型
          </button>
        </div>
      )}

      <div className="model-list">
        {list.length === 0 && <div className="muted">暂无模型</div>}
        {list.map((m) => (
          <div className="region-row" key={m.id}>
            <div>
              <div className="region-name">
                {m.name}
                {m.active && <span className="status-pill status-RUNNING" style={{ marginLeft: '0.5rem' }}>启用中</span>}
              </div>
              <div className="region-desc">
                {m.filePath}
                {m.type ? ` · 类型: ${m.type}` : ''}
                {m.createdAt ? ` · ${m.createdAt}` : ''}
              </div>
            </div>
            <div className="region-actions">
              {!m.active && isAdmin && (
                <button type="button" onClick={() => activate(m.id)}>
                  设为启用
                </button>
              )}
              {isAdmin && (
                <button type="button" className="danger" onClick={() => remove(m.id)}>
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
