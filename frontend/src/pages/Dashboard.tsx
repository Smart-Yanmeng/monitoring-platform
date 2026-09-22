import { useEffect, useState } from 'react'

type Component = {
  status: string
  details?: Record<string, unknown>
}

type Health = {
  status: string
  components?: Record<string, Component>
}

function Badge({ status }: { status: string }) {
  const cls = status === 'UP' ? 'up' : status === 'DOWN' ? 'down' : 'unknown'
  return <span className={`badge ${cls}`}>{status}</span>
}

function detailText(details?: Record<string, unknown>): string {
  if (!details) return ''
  return Object.entries(details)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('  ·  ')
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/actuator/health')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: Health = await res.json()
        setHealth(data)
        setError(null)
        setUpdatedAt(new Date().toLocaleTimeString())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const components = health?.components
    ? Object.entries(health.components)
    : []

  return (
    <div className="app">
      <h1>仪表盘</h1>
      <p className="subtitle">后端健康监控 · 每 5 秒自动刷新</p>

      <div className="card">
        <div className="row">
          <span className="name">整体状态</span>
          {error ? (
            <Badge status="DOWN" />
          ) : health ? (
            <Badge status={health.status} />
          ) : (
            <Badge status="UNKNOWN" />
          )}
        </div>
        {error && <div className="detail">连接后端失败：{error}</div>}
      </div>

      {components.length > 0 && (
        <div className="card">
          {components.map(([name, c]) => (
            <div className="row" key={name}>
              <div>
                <div className="name">{name}</div>
                {detailText(c.details) && (
                  <div className="detail">{detailText(c.details)}</div>
                )}
              </div>
              <Badge status={c.status} />
            </div>
          ))}
        </div>
      )}

      <div className="footer">
        {updatedAt ? `最后刷新：${updatedAt}` : '加载中…'}
      </div>
    </div>
  )
}
