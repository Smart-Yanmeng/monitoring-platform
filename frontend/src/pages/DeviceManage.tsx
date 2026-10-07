import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getToken } from '../auth'
import { useAuth } from '../authContext'
import Select from '../components/Select'

type Device = {
  id: number
  name: string
  type: 'CAMERA' | 'ALARM'
  regionId: number | null
  regionName: string | null
  address: string | null
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
  note: string | null
}

type RegionLite = { id: number; name: string; parentId: number | null }

const TYPE_LABEL: Record<string, string> = { CAMERA: '摄像头', ALARM: '报警点' }
const STATUS_LABEL: Record<string, string> = { ONLINE: '在线', OFFLINE: '离线', UNKNOWN: '未知' }

export default function DeviceManage() {
  const navigate = useNavigate()
  const { me } = useAuth()
  const isAdmin = !!me?.authorities.includes('ROLE_ADMIN')

  const [devices, setDevices] = useState<Device[]>([])
  const [regions, setRegions] = useState<RegionLite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filterRegion, setFilterRegion] = useState('')
  const [editing, setEditing] = useState<Device | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'CAMERA',
    regionId: '',
    address: '',
    status: 'UNKNOWN',
    note: '',
  })

  const load = async () => {
    if (!getToken()) {
      navigate('/login')
      return
    }
    setError(null)
    const [dr, rr] = await Promise.all([api('/api/devices'), api('/api/regions')])
    if (dr.status === 401 || rr.status === 401) {
      navigate('/login')
      return
    }
    if (dr.ok) setDevices(await dr.json())
    if (rr.ok) setRegions(await rr.json())
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 地区完整路径：祖父 / 父 / 本
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

  const reset = () => {
    setEditing(null)
    setForm({ name: '', type: 'CAMERA', regionId: '', address: '', status: 'UNKNOWN', note: '' })
  }

  const startEdit = (d: Device) => {
    setEditing(d)
    setForm({
      name: d.name,
      type: d.type,
      regionId: d.regionId == null ? '' : String(d.regionId),
      address: d.address ?? '',
      status: d.status,
      note: d.note ?? '',
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setError('请输入名称')
      return
    }
    const payload = {
      name,
      type: form.type,
      regionId: form.regionId ? Number(form.regionId) : null,
      address: form.address.trim() || null,
      status: form.status,
      note: form.note.trim() || null,
    }
    const res = editing
      ? await api('/api/devices/' + editing.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await api('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
    if (res.ok) {
      reset()
      load()
    } else if (res.status === 403) {
      setError('仅管理员可绑定设备')
    } else {
      const msg = await res.text().catch(() => '')
      setError((editing ? '保存失败: ' : '创建失败: ') + res.status + (msg ? ' ' + msg : ''))
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('确定删除该设备？')) return
    const res = await api('/api/devices/' + id, { method: 'DELETE' })
    if (res.ok) load()
    else if (res.status === 403) setError('仅管理员可删除设备')
    else setError('删除失败: ' + res.status)
  }

  const visible = useMemo(() => {
    const list = filterRegion ? devices.filter((d) => String(d.regionId) === filterRegion) : devices
    return [...list].sort((a, b) => a.id - b.id)
  }, [devices, filterRegion])

  return (
    <div>
      <h2>设备管理</h2>
      <p className="detail">
        将摄像头 / 报警点绑定到地区（校区 → 楼栋 → 楼层 → 具体地点）。仅管理员可新增、编辑、删除与绑定。
      </p>
      {error && (
        <div className="detail" style={{ color: '#f85149' }}>
          {error}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <form className="menu-form" onSubmit={submit}>
            <input
              placeholder="设备名称（如 306网络摄像机 / 3号楼烟感）"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={[
                { value: 'CAMERA', label: '摄像头' },
                { value: 'ALARM', label: '报警点' },
              ]}
            />
            <Select
              value={form.regionId}
              onChange={(v) => setForm({ ...form, regionId: v })}
              options={[
                { value: '', label: '未分配地区' },
                ...regions.map((r) => ({
                  value: String(r.id),
                  label: regionPath(r.id) || r.name,
                })),
              ]}
            />
            <input
              placeholder="地址 / 通道 / RTSP"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <Select
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={[
                { value: 'UNKNOWN', label: '未知' },
                { value: 'ONLINE', label: '在线' },
                { value: 'OFFLINE', label: '离线' },
              ]}
            />
            <input
              placeholder="备注（可选）"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <button type="submit">{editing ? '保存' : '新增设备'}</button>
            {editing && (
              <button type="button" onClick={reset}>
                取消
              </button>
            )}
          </form>
        </div>
      )}

      {!isAdmin && (
        <div className="card">
          <div className="detail">当前为只读视图，绑定设备请联系管理员。</div>
        </div>
      )}

      <div className="card">
        <div className="menu-form" style={{ marginBottom: '0.6rem' }}>
          <Select
            value={filterRegion}
            onChange={setFilterRegion}
            options={[
              { value: '', label: '全部地区' },
              ...regions.map((r) => ({
                value: String(r.id),
                label: regionPath(r.id) || r.name,
              })),
            ]}
          />
        </div>
        <table className="menu-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>所属地区</th>
              <th>地址 / 通道</th>
              <th>状态</th>
              <th>备注</th>
              {isAdmin && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{TYPE_LABEL[d.type] ?? d.type}</td>
                <td>{d.regionId == null ? '—' : regionPath(d.regionId) || d.regionName}</td>
                <td>{d.address ?? '—'}</td>
                <td>{STATUS_LABEL[d.status] ?? d.status}</td>
                <td>{d.note ?? '—'}</td>
                {isAdmin && (
                  <td>
                    <button type="button" onClick={() => startEdit(d)}>
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => remove(d.id)}>
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6}>暂无设备</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
