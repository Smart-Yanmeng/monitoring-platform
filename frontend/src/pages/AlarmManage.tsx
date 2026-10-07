import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getToken } from '../auth'
import { useAuth } from '../authContext'
import Select from '../components/Select'

type AlarmEvent = {
  id: number
  deviceId: number | null
  deviceName: string | null
  regionId: number | null
  regionName: string | null
  reason: string
  level: 'INFO' | 'WARNING' | 'CRITICAL'
  time: string
  handled: boolean
  handledTime: string | null
  note: string | null
}

type Device = {
  id: number
  name: string
  regionId: number | null
}

type RegionLite = { id: number; name: string; parentId: number | null }

const LEVEL_LABEL: Record<string, string> = { INFO: '提示', WARNING: '警告', CRITICAL: '严重' }

export default function AlarmManage() {
  const navigate = useNavigate()
  const { me } = useAuth()
  const isAdmin = !!me?.authorities.includes('ROLE_ADMIN')

  const [tab, setTab] = useState<'events' | 'points'>('events')
  const [regions, setRegions] = useState<RegionLite[]>([])
  const [alarmDevices, setAlarmDevices] = useState<Device[]>([])
  const [events, setEvents] = useState<AlarmEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const [filterRegion, setFilterRegion] = useState('')
  const [filterHandled, setFilterHandled] = useState<'all' | 'unhandled' | 'handled'>('unhandled')
  const [filterDevice, setFilterDevice] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState<Record<number, string>>({})

  const [sim, setSim] = useState({ deviceId: '', reason: '', level: 'WARNING' })

  const loadEvents = async () => {
    const qs = new URLSearchParams()
    if (filterRegion) qs.set('regionId', filterRegion)
    if (filterHandled === 'unhandled') qs.set('handled', 'false')
    if (filterHandled === 'handled') qs.set('handled', 'true')
    if (filterDevice) qs.set('deviceId', filterDevice)
    if (startTime) qs.set('startTime', startTime)
    if (endTime) qs.set('endTime', endTime)
    const res = await api('/api/alarms?' + qs.toString())
    if (res.ok) setEvents(await res.json())
    else setError('加载报警失败: ' + res.status)
  }

  useEffect(() => {
    const load = async () => {
      if (!getToken()) {
        navigate('/login')
        return
      }
      setError(null)
      const [rr, dr] = await Promise.all([api('/api/regions'), api('/api/devices?type=ALARM')])
      if (rr.status === 401 || dr.status === 401) {
        navigate('/login')
        return
      }
      if (rr.ok) setRegions(await rr.json())
      if (dr.ok) setAlarmDevices(await dr.json())
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tab === 'events') loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterRegion, filterHandled, filterDevice, startTime, endTime])

  const regionPath = (id: number | null): string => {
    if (id == null) return ''
    const byId = new Map(regions.map((r) => [r.id, r]))
    const parts: string[] = []
    let cur = byId.get(id)
    let guard = 0
    while (cur && guard++ < 50) {
      parts.unshift(cur.name)
      cur = cur.parentId == null ? undefined : byId.get(cur.parentId)
    }
    return parts.join(' / ')
  }

  const simulate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sim.reason.trim()) {
      setError('请输入报警原因')
      return
    }
    if (!sim.deviceId) {
      setError('请选择报警点设备')
      return
    }
    const res = await api('/api/alarms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: Number(sim.deviceId),
        reason: sim.reason.trim(),
        level: sim.level,
      }),
    })
    if (res.ok) {
      setSim({ deviceId: '', reason: '', level: 'WARNING' })
      setFilterHandled('unhandled')
      loadEvents()
    } else {
      const msg = await res.text().catch(() => '')
      setError('模拟报警失败: ' + res.status + (msg ? ' ' + msg : ''))
    }
  }

  const handleAlarm = async (id: number) => {
    const res = await api('/api/alarms/' + id + '/handle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: notes[id] ?? '' }),
    })
    if (res.ok) {
      setNotes((n) => {
        const c = { ...n }
        delete c[id]
        return c
      })
      loadEvents()
    } else setError('处理失败: ' + res.status)
  }

  const exportCsv = async () => {
    const qs = new URLSearchParams()
    if (filterRegion) qs.set('regionId', filterRegion)
    if (filterHandled === 'unhandled') qs.set('handled', 'false')
    if (filterHandled === 'handled') qs.set('handled', 'true')
    if (filterDevice) qs.set('deviceId', filterDevice)
    if (startTime) qs.set('startTime', startTime)
    if (endTime) qs.set('endTime', endTime)
    const res = await fetch('/api/alarms/export?' + qs.toString(), {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
    if (!res.ok) {
      setError('导出失败: ' + res.status)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'alarms.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const remove = async (id: number) => {
    if (!window.confirm('确定删除该报警记录？')) return
    const res = await api('/api/alarms/' + id, { method: 'DELETE' })
    if (res.ok) loadEvents()
    else if (res.status === 403) setError('仅管理员可删除报警')
    else setError('删除失败: ' + res.status)
  }

  const visibleEvents = useMemo(() => [...events].sort((a, b) => b.id - a.id), [events])

  return (
    <div>
      <h2>报警管理</h2>
      <p className="detail">
        报警事件：传感器/摄像头触发后生成记录，可在「视频墙」左侧实时查看，并在此按地区筛选并标记处理。
      </p>
      {error && (
        <div className="detail" style={{ color: '#f85149' }}>
          {error}
        </div>
      )}

      <div className="tabs">
        <button
          className={tab === 'events' ? 'tab active' : 'tab'}
          onClick={() => setTab('events')}
        >
          报警事件
        </button>
        <button
          className={tab === 'points' ? 'tab active' : 'tab'}
          onClick={() => setTab('points')}
        >
          报警点设备
        </button>
      </div>

      {tab === 'events' && (
        <>
          <div className="card">
            <form className="menu-form" onSubmit={simulate}>
              <Select
                value={sim.deviceId}
                onChange={(v) => setSim({ ...sim, deviceId: v })}
                options={[
                  { value: '', label: '选择报警点设备' },
                  ...alarmDevices.map((d) => ({
                    value: String(d.id),
                    label: d.name + (d.regionId != null ? '（' + (regionPath(d.regionId) || '') + '）' : ''),
                  })),
                ]}
              />
              <input
                placeholder="报警原因（如 红外触发 / 门磁开启）"
                value={sim.reason}
                onChange={(e) => setSim({ ...sim, reason: e.target.value })}
              />
              <Select
                value={sim.level}
                onChange={(v) => setSim({ ...sim, level: v })}
                options={[
                  { value: 'INFO', label: '提示' },
                  { value: 'WARNING', label: '警告' },
                  { value: 'CRITICAL', label: '严重' },
                ]}
              />
              <button type="submit">模拟报警</button>
            </form>
          </div>

          <div className="card">
            <div className="menu-form" style={{ marginBottom: '0.6rem' }}>
              <Select
                value={filterRegion}
                onChange={setFilterRegion}
                options={[
                  { value: '', label: '全部地区' },
                  ...regions.map((r) => ({ value: String(r.id), label: regionPath(r.id) || r.name })),
                ]}
              />
              <Select
                value={filterHandled}
                onChange={(v) => setFilterHandled(v as 'all' | 'unhandled' | 'handled')}
                options={[
                  { value: 'unhandled', label: '未处理' },
                  { value: 'handled', label: '已处理' },
                  { value: 'all', label: '全部' },
                ]}
              />
              <Select
                value={filterDevice}
                onChange={setFilterDevice}
                options={[
                  { value: '', label: '全部报警点' },
                  ...alarmDevices.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
              />
              <input
                type="date"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                title="开始时间"
              />
              <input
                type="date"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                title="结束时间"
              />
              <button type="button" onClick={exportCsv}>
                导出CSV
              </button>
            </div>
            <table className="menu-table">
              <thead>
                <tr>
                  <th>报警点</th>
                  <th>所属地区</th>
                  <th>原因</th>
                  <th>等级</th>
                  <th>时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.deviceName ?? '—'}</td>
                    <td>{ev.regionId == null ? '—' : regionPath(ev.regionId) || ev.regionName}</td>
                    <td>{ev.reason}</td>
                    <td>{LEVEL_LABEL[ev.level] ?? ev.level}</td>
                    <td>{ev.time}</td>
                    <td>
                      {ev.handled ? (
                        <span style={{ color: '#3fb950' }}>已处理{ev.handledTime ? ' · ' + ev.handledTime : ''}</span>
                      ) : (
                        <span style={{ color: '#f85149' }}>未处理</span>
                      )}
                    </td>
                    <td>
                      {!ev.handled && (
                        <>
                          <input
                            className="note-input"
                            placeholder="处理备注"
                            value={notes[ev.id] ?? ''}
                            onChange={(e) => setNotes((n) => ({ ...n, [ev.id]: e.target.value }))}
                          />
                          <button type="button" onClick={() => handleAlarm(ev.id)}>
                            标记已处理
                          </button>
                        </>
                      )}
                      {isAdmin && (
                        <button type="button" className="danger" onClick={() => remove(ev.id)}>
                          删除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleEvents.length === 0 && (
                  <tr>
                    <td colSpan={7}>暂无报警记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'points' && (
        <div className="card">
          <p className="detail">报警点即「设备管理」中类型为「报警点」的设备，新增与绑定请在设备管理页操作。</p>
          <table className="menu-table">
            <thead>
              <tr>
                <th>报警点名称</th>
                <th>所属地区</th>
                <th>地址 / 通道</th>
                <th>状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {alarmDevices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.regionId == null ? '—' : regionPath(d.regionId)}</td>
                  <td>{'—'}</td>
                  <td>{'—'}</td>
                  <td>{'—'}</td>
                </tr>
              ))}
              {alarmDevices.length === 0 && (
                <tr>
                  <td colSpan={5}>暂无报警点设备，请到「设备管理」添加</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
