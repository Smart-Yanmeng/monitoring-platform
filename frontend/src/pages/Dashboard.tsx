import { useCallback, useEffect, useState } from 'react'
import { api } from '../auth'

type HealthComponent = { status: string; details?: Record<string, unknown> }
type Health = { status: string; components?: Record<string, HealthComponent> }

type Device = { id: number; name: string; status: string; regionName?: string | null }
type Alarm = {
  id: number
  deviceId: number | null
  deviceName?: string | null
  regionName?: string | null
  level: string
  handled: boolean
  reason: string
  time: string
}
type AiStatus = {
  online: boolean
  activeModel: string | null
  cameras: { id: number; status: string }[]
}
type Model = { id: number; name: string; filePath: string; active: boolean }

/** actuator 组件名 → 中文标签；未收录的（ping/ssl 等）一律隐藏 */
const HEALTH_LABEL: Record<string, string> = {
  db: '数据库',
  diskSpace: '磁盘存储',
  livenessState: '服务存活',
  readinessState: '服务就绪',
}

const LEVEL_META: Record<string, { label: string; tone: string }> = {
  CRITICAL: { label: '严重', tone: 'red' },
  WARNING: { label: '警告', tone: 'amber' },
  INFO: { label: '提示', tone: 'sky' },
}

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  )
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [alarms, setAlarms] = useState<Alarm[]>([])
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')
  const [paused, setPaused] = useState(false)

  const load = useCallback(async () => {
    const get = async <T,>(path: string, fallback: T): Promise<T> => {
      try {
        const res = await api(path)
        return res.ok ? ((await res.json()) as T) : fallback
      } catch {
        return fallback
      }
    }
    try {
      const res = await fetch('/actuator/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHealth((await res.json()) as Health)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    const [d, a, s, m] = await Promise.all([
      get<Device[]>('/api/devices', []),
      get<Alarm[]>('/api/alarms', []),
      get<AiStatus>('/api/ai/status', { online: false, activeModel: null, cameras: [] }),
      get<Model[]>('/api/models', []),
    ])
    setDevices(d)
    setAlarms(a)
    setAi(s)
    setModels(m)
    setUpdatedAt(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    load()
    if (paused) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load, paused])

  const total = alarms.length
  const unhandled = alarms.filter((a) => !a.handled)
  const handled = total - unhandled.length
  const online = devices.filter((d) => d.status === 'ONLINE').length
  const critical = alarms.filter((a) => a.level === 'CRITICAL').length
  const camOnline = ai ? ai.cameras.filter((c) => c.status === 'ONLINE').length : 0
  const activeModel = models.find((m) => m.active)
  const down = Boolean(error) || health?.status === 'DOWN'

  const healthItems = Object.entries(health?.components ?? {})
    .filter(([name]) => name in HEALTH_LABEL)
    .map(([name, c]) => ({ label: HEALTH_LABEL[name], status: c.status }))

  const disk = (() => {
    const d = health?.components?.diskSpace?.details
    if (!d) return null
    const totalB = Number(d.total)
    const free = Number(d.free)
    if (!Number.isFinite(totalB) || !Number.isFinite(free) || totalB <= 0) return null
    return {
      usedPct: Math.round(((totalB - free) / totalB) * 100),
      freeGB: free / 1024 ** 3,
      totalGB: totalB / 1024 ** 3,
    }
  })()

  const dotTone = (s: string) => (s === 'UP' ? 'ok' : s === 'DOWN' ? 'bad' : 'warn')

  return (
    <div className="z-page">
      {/* 页面标题 */}
      <div>
        <div className="z-head">
          <h1 className="z-h1">仪表盘</h1>
          <span className={`z-live ${paused ? 'idle' : ''}`}>
            <i />
            {paused ? '已暂停' : '实时'}
          </span>
        </div>
        <p className="z-head-sub">后端健康监控 · 每 5 秒自动刷新{updatedAt ? ` · 最后刷新 ${updatedAt}` : ''}</p>
      </div>

      {error && <div className="z-alert">连接后端失败：{error}</div>}

      {/* 平台总览 */}
      <section className="z-card">
        <div className="z-card-head">
          <div>
            <h2 className="z-sec" style={{ margin: 0 }}>平台总览</h2>
            <p className="z-head-sub" style={{ marginTop: '0.35rem' }}>
              {ai?.online ? 'AI 引擎运行中' : 'AI 引擎离线'} ·
              {activeModel ? ` 当前模型 ${activeModel.name}` : ' 未加载模型'}
            </p>
          </div>
          <div className="z-btn-group">
            <button type="button" className="z-btn" onClick={() => setPaused((p) => !p)}>
              {paused ? '继续' : '暂停'}
            </button>
            <button type="button" className="z-btn" onClick={load}>
              <RefreshIcon />
              刷新
            </button>
          </div>
        </div>

        <div className="z-stats">
          <div className="z-stat">
            <div className="z-stat-value">{devices.length}</div>
            <div className="z-stat-label">设备总数</div>
          </div>
          <div className="z-stat">
            <div className="z-stat-value">{total}</div>
            <div className="z-stat-label">报警总数</div>
          </div>
          <div className="z-stat">
            <div className="z-stat-value">{unhandled.length}</div>
            <div className="z-stat-label">未处理报警</div>
          </div>
          <div className="z-stat">
            <div className="z-stat-value" style={{ color: critical > 0 ? '#f87171' : undefined }}>
              {critical}
            </div>
            <div className="z-stat-label">严重报警</div>
          </div>
        </div>
      </section>

      {/* 报警分布 */}
      <section className="z-card">
        <h3 className="z-sec">报警分布</h3>
        {total === 0 ? (
          <p className="z-empty">暂无报警记录</p>
        ) : (
          <div className="z-dist-grid">
            {Object.entries(LEVEL_META).map(([key, meta]) => {
              const n = alarms.filter((a) => a.level === key).length
              return (
                <Dist
                  key={key}
                  label={meta.label}
                  tone={meta.tone}
                  count={n}
                  total={total}
                />
              )
            })}
            <Dist label="未处理" tone="amber" count={unhandled.length} total={total} />
            <Dist label="已处理" tone="emerald" count={handled} total={total} />
            <Dist
              label="设备在线"
              tone="sky"
              count={online}
              total={devices.length}
            />
          </div>
        )}
      </section>

      {/* 最新报警 */}
      <section className="z-card">
        <div className="z-card-head" style={{ marginBottom: '0.75rem' }}>
          <h3 className="z-sec" style={{ margin: 0 }}>最新报警</h3>
          {unhandled.length > 0 && (
            <span className="z-badge tone-amber">
              <AlertIcon />
              {unhandled.length} 条待处理
            </span>
          )}
        </div>

        {alarms.length === 0 ? (
          <p className="z-empty">暂无报警记录</p>
        ) : (
          <div className="z-table-wrap">
            <table className="z-table">
              <thead>
                <tr>
                  <th>报警编号</th>
                  <th>设备</th>
                  <th>区域</th>
                  <th>报警原因</th>
                  <th>级别</th>
                  <th>处理状态</th>
                  <th>触发时间</th>
                </tr>
              </thead>
              <tbody>
                {alarms.slice(0, 8).map((a) => {
                  const meta = LEVEL_META[a.level] ?? { label: a.level, tone: 'muted' }
                  return (
                    <tr key={a.id}>
                      <td className="z-mono">AL{a.id.toString().padStart(6, '0')}</td>
                      <td>
                        <div className="z-cell-title">{a.deviceName ?? '未知设备'}</div>
                        <div className="z-cell-sub">DEV-{String(a.deviceId ?? 0).padStart(4, '0')}</div>
                      </td>
                      <td className="z-cell-muted">{a.regionName ?? '未关联'}</td>
                      <td>{a.reason}</td>
                      <td>
                        <span className={`z-badge tone-${meta.tone}`}>{meta.label}</span>
                      </td>
                      <td>
                        <span className={`z-badge ${a.handled ? 'tone-emerald' : 'tone-amber'}`}>
                          {a.handled ? '已处理' : '待处理'}
                        </span>
                      </td>
                      <td className="z-cell-muted">{a.time}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 系统健康 */}
      <section className="z-card">
        <div className="z-card-head" style={{ marginBottom: '0.75rem' }}>
          <h3 className="z-sec" style={{ margin: 0 }}>系统健康</h3>
          <span className={`z-badge ${down ? 'tone-red' : 'tone-emerald'}`}>
            {down ? 'DOWN' : 'UP'}
          </span>
        </div>

        <div className="z-health">
          {healthItems.map((h) => (
            <div className="z-health-row" key={h.label}>
              <span className="z-cell-muted">{h.label}</span>
              <span className="z-health-status">
                <i className={`z-dot ${dotTone(h.status)}`} />
                {h.status}
              </span>
            </div>
          ))}

          {disk && (
            <div className="z-disk">
              <div className="z-disk-head">
                <span className="name">磁盘占用</span>
                <span className="z-cell-muted">
                  {disk.usedPct}% · 剩余 {disk.freeGB.toFixed(1)} GB / {disk.totalGB.toFixed(0)} GB
                </span>
              </div>
              <div className="z-track">
                <div className="z-fill" style={{ width: `${disk.usedPct}%` }} />
              </div>
            </div>
          )}

          {ai && (
            <div className="z-health-row">
              <span className="z-cell-muted">AI 摄像头</span>
              <span className="z-health-status">
                <i className={`z-dot ${camOnline > 0 ? 'ok' : 'muted'}`} />
                {camOnline} / {ai.cameras.length} 在线
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Dist({
  label,
  count,
  total,
  tone,
}: {
  label: string
  count: number
  total: number
  tone: string
}) {
  return (
    <div>
      <div className="z-dist-top">
        <span className={`z-badge tone-${tone}`}>{label}</span>
        <span className="z-dist-num">{count}</span>
      </div>
      <div className="z-track">
        <div className="z-fill" style={{ width: `${pct(count, total)}%` }} />
      </div>
    </div>
  )
}
