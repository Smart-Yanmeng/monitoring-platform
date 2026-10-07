import { useEffect, useRef, useState } from 'react'
import { api } from '../auth'

type CameraStatus = { id: number; status: string }
type AiStatus = {
  lastHeartbeat: number
  activeModel: string | null
  online: boolean
  cameras: CameraStatus[]
}
type Device = { id: number; name: string; regionId: number | null }
type Region = { id: number; name: string }

const STATUS_LABEL: Record<string, string> = {
  RUNNING: '推理中',
  OFFLINE: '离线',
}

export default function AiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const timer = useRef<number | null>(null)

  const loadAll = async () => {
    const [sr, dr, rr] = await Promise.all([
      api('/api/ai/status'),
      api('/api/devices?type=CAMERA'),
      api('/api/regions'),
    ])
    if (sr.ok) setStatus(await sr.json())
    if (dr.ok) setDevices(await dr.json())
    if (rr.ok) setRegions(await rr.json())
  }

  useEffect(() => {
    loadAll()
    timer.current = window.setInterval(loadAll, 5000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [])

  const regionName = (id: number | null) =>
    id == null ? '—' : regions.find((r) => r.id === id)?.name ?? '?'
  const statusById = (id: number) => status?.cameras.find((c) => c.id === id)?.status
  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })

  return (
    <div className="page">
      <h2>AI 服务状态</h2>

      <div className="ai-card">
        <div className="ai-card-row">
          <span className="muted">AI 服务</span>
          {status?.online ? (
            <span className="status-pill status-RUNNING">在线</span>
          ) : (
            <span className="status-pill status-OFFLINE">离线</span>
          )}
        </div>
        <div className="ai-card-row">
          <span className="muted">当前启用模型</span>
          <span>{status?.activeModel || '（未上报）'}</span>
        </div>
        <div className="ai-card-row">
          <span className="muted">最后心跳</span>
          <span>
            {status && status.lastHeartbeat > 0 ? fmtTime(status.lastHeartbeat) : '—'}
          </span>
        </div>
      </div>

      <h3 style={{ marginTop: '1.2rem' }}>摄像头状态</h3>
      <div className="model-list">
        {devices.length === 0 && <div className="muted">暂无摄像头设备</div>}
        {devices.map((d) => {
          const s = statusById(d.id)
          const label = s ? STATUS_LABEL[s] ?? s : '未连接'
          return (
            <div className="region-row" key={d.id}>
              <div>
                <div className="region-name">{d.name}</div>
                <div className="region-desc">{regionName(d.regionId)}</div>
              </div>
              <div className="region-actions">
                <span
                  className={
                    s === 'RUNNING'
                      ? 'status-pill status-RUNNING'
                      : s === 'OFFLINE'
                        ? 'status-pill status-OFFLINE'
                        : 'status-pill'
                  }
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
