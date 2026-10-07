import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getToken } from '../auth'
import Select from '../components/Select'
import { useAuth } from '../authContext'

type Region = {
  id: number
  name: string
  parentId: number | null
  sortOrder: number
  description: string | null
}

type Device = {
  id: number
  name: string
  type: 'CAMERA' | 'ALARM'
  regionId: number | null
  address: string | null
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
  note: string | null
}

/** 摄像头标记内的小图标（lucide camera 线条风格） */
function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

export default function RegionManage() {
  const navigate = useNavigate()
  const { me } = useAuth()
  const isAdmin = !!me?.authorities.includes('ROLE_ADMIN')

  const [regions, setRegions] = useState<Region[]>([])
  const [cameras, setCameras] = useState<Device[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Region | null>(null)
  const [form, setForm] = useState({ name: '', parentId: '', sortOrder: '99', description: '' })

  // 绑定摄像头弹窗
  const [bindTarget, setBindTarget] = useState<Region | null>(null)
  const [bindMsg, setBindMsg] = useState<string | null>(null)
  const [bindErr, setBindErr] = useState<string | null>(null)
  const [bindBusy, setBindBusy] = useState(false)

  const load = async () => {
    if (!getToken()) {
      navigate('/login')
      return
    }
    setError(null)
    const [rr, dr] = await Promise.all([api('/api/regions'), api('/api/devices?type=CAMERA')])
    if (rr.status === 401 || dr.status === 401) {
      navigate('/login')
      return
    }
    if (!rr.ok) {
      setError('加载失败: ' + rr.status)
      return
    }
    setRegions(await rr.json())
    // 摄像头加载失败不影响地区树展示
    if (dr.ok) setCameras(await dr.json())
  }

  /** 某地区直接挂的摄像头（不含下级） */
  const camerasOf = (regionId: number) => cameras.filter((c) => c.regionId === regionId)

  /** 某地区及其所有下级地区挂的摄像头 */
  const camerasUnder = (region: Region): Device[] => {
    const ids = new Set<number>([region.id])
    const stack = [region.id]
    while (stack.length) {
      const pid = stack.pop()!
      for (const r of regions) {
        if (r.parentId === pid) {
          ids.add(r.id)
          stack.push(r.id)
        }
      }
    }
    return cameras.filter((c) => c.regionId != null && ids.has(c.regionId))
  }

  const openBind = (r: Region) => {
    setBindTarget(r)
    setBindMsg(null)
    setBindErr(null)
  }

  /** 跳到视频监控页并定位到该摄像头（带 state 由 VideoWall 读取） */
  const goCamera = (cam: Device) => {
    setBindTarget(null)
    navigate('/', { state: { deviceId: cam.id } })
  }

  /** 把摄像头绑定到当前地区（后端 PUT 为全量更新，需带完整字段） */
  const bindCamera = async (cam: Device) => {
    if (!bindTarget) return
    setBindBusy(true)
    setBindErr(null)
    try {
      const res = await api('/api/devices/' + cam.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cam.name,
          type: cam.type,
          regionId: bindTarget.id,
          address: cam.address,
          status: cam.status,
          note: cam.note,
        }),
      })
      if (res.ok) {
        setBindMsg(`已将「${cam.name}」绑定到${bindTarget.name}`)
        await load()
      } else {
        setBindErr('绑定失败: ' + res.status)
      }
    } catch (e) {
      setBindErr('绑定异常: ' + (e as Error).message)
    } finally {
      setBindBusy(false)
    }
  }

  /** 解绑：把设备的 regionId 置空 */
  const unbindCamera = async (cam: Device) => {
    setBindBusy(true)
    setBindErr(null)
    try {
      const res = await api('/api/devices/' + cam.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cam.name,
          type: cam.type,
          regionId: null,
          address: cam.address,
          status: cam.status,
          note: cam.note,
        }),
      })
      if (res.ok) {
        setBindMsg(`已解绑「${cam.name}」`)
        await load()
      } else {
        setBindErr('解绑失败: ' + res.status)
      }
    } catch (e) {
      setBindErr('解绑异常: ' + (e as Error).message)
    } finally {
      setBindBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 编辑时，父级下拉排除自身及其后代，避免成环
  const blockedIds = useMemo(() => {
    if (!editing) return new Set<number>()
    const blocked = new Set<number>([editing.id])
    const stack = [editing.id]
    while (stack.length) {
      const pid = stack.pop()!
      for (const r of regions) {
        if (r.parentId === pid) {
          blocked.add(r.id)
          stack.push(r.id)
        }
      }
    }
    return blocked
  }, [editing, regions])

  // 生成完整路径：祖父 / 父 / 本
  const pathOf = (id: number | null): string => {
    if (id == null) return ''
    const parts: string[] = []
    let cur = regions.find((r) => r.id === id)
    let guard = 0
    while (cur && guard++ < 50) {
      parts.unshift(cur.name)
      cur = cur.parentId == null ? undefined : regions.find((r) => r.id === cur!.parentId!)
    }
    return parts.join(' / ')
  }

  const reset = () => {
    setEditing(null)
    setForm({ name: '', parentId: '', sortOrder: '99', description: '' })
  }

  const startEdit = (r: Region) => {
    setEditing(r)
    setForm({
      name: r.name,
      parentId: r.parentId == null ? '' : String(r.parentId),
      sortOrder: String(r.sortOrder),
      description: r.description ?? '',
    })
  }

  const addChild = (parent: Region) => {
    reset()
    setForm((f) => ({ ...f, parentId: String(parent.id) }))
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
      parentId: form.parentId ? Number(form.parentId) : null,
      sortOrder: Number(form.sortOrder) || 0,
      description: form.description.trim() || null,
    }
    const res = editing
      ? await api('/api/regions/' + editing.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await api('/api/regions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
    if (res.ok) {
      reset()
      load()
    } else {
      const msg = await res.text().catch(() => '')
      setError((editing ? '保存失败: ' : '创建失败: ') + res.status + (msg ? ' ' + msg : ''))
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('确定删除该地区及其所有下级地区？')) return
    const res = await api('/api/regions/' + id, { method: 'DELETE' })
    if (res.ok) load()
    else setError('删除失败: ' + res.status)
  }

  const childrenOf = (pid: number | null) =>
    regions
      .filter((r) => (r.parentId ?? null) === (pid ?? null))
      .sort((a, b) => a.sortOrder - b.sortOrder)

  const renderNode = (node: Region, depth: number) => {
    const own = camerasOf(node.id)
    const under = camerasUnder(node)
    // 自身已绑定 → 实心标记；仅下级有 → 幽灵标记（提示可继续下沉绑定）
    const hasOwn = own.length > 0
    const hasUnder = under.length > 0
    return (
      <div key={node.id}>
        <div className="region-row" style={{ paddingLeft: 12 + depth * 22 }}>
          <div className="region-main">
            <span className="region-name">{node.name}</span>
            {(hasOwn || hasUnder) && (
              <span
                className={'cam-badge' + (hasOwn ? ' cam-badge--own' : ' cam-badge--under')}
                title={
                  hasOwn
                    ? `本级已绑定 ${own.length} 个摄像头`
                    : `下级共 ${under.length} 个摄像头`
                }
              >
                <CameraGlyph />
                {hasOwn ? own.length : under.length}
              </span>
            )}
            {node.description && <span className="region-desc">{node.description}</span>}
          </div>
          <span className="region-actions">
            {/* 绑定/解绑是写操作，需 ROLE_ADMIN（后端 PUT /api/devices 亦要求） */}
            <button type="button" disabled={!isAdmin} onClick={() => openBind(node)}>
              摄像头
            </button>
            <button type="button" onClick={() => addChild(node)}>
              添加子级
            </button>
            <button type="button" onClick={() => startEdit(node)}>
              编辑
            </button>
            <button type="button" className="danger" onClick={() => remove(node.id)}>
              删除
            </button>
          </span>
        </div>
        {childrenOf(node.id).map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  const roots = childrenOf(null)

  return (
    <div>
      <h2>地区管理</h2>
      <p className="detail">
        支持多级地区（如：学校 → 校区 → 楼栋 → 楼层 → 具体地点）。删除会级联删除其全部下级。
      </p>
      {error && (
        <div className="detail" style={{ color: '#f85149' }}>
          {error}
        </div>
      )}

      <div className="card">
        <form className="menu-form" onSubmit={submit}>
          <input
            placeholder="名称（如 第五社区 / 3号楼 / 1层 / 大厅）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            value={form.parentId}
            onChange={(v) => setForm({ ...form, parentId: v })}
            options={[
              { value: '', label: '顶级地区（无上级）' },
              ...regions
                .filter((r) => !blockedIds.has(r.id))
                .map((r) => ({
                  value: String(r.id),
                  label: pathOf(r.parentId) ? pathOf(r.parentId) + ' / ' + r.name : r.name,
                })),
            ]}
          />
          <input
            placeholder="排序"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            style={{ width: 80 }}
          />
          <input
            placeholder="描述（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <button type="submit">{editing ? '保存' : '新增地区'}</button>
          {editing && (
            <button type="button" onClick={reset}>
              取消
            </button>
          )}
        </form>
      </div>

      <div className="card">
        {roots.length === 0 ? (
          <div className="detail">暂无地区，请在上方添加顶级地区。</div>
        ) : (
          roots.map((r) => renderNode(r, 0))
        )}
      </div>

      {/* 绑定摄像头弹窗 */}
      {bindTarget && (
        <div className="bind-overlay" onClick={() => setBindTarget(null)}>
          <div
            className="bind-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="绑定摄像头"
          >
            <div className="bind-head">
              <h3>绑定摄像头 · {bindTarget.name}</h3>
              <button type="button" className="bind-close" onClick={() => setBindTarget(null)}>
                ×
              </button>
            </div>

            <div className="bind-sec">
              <div className="bind-sec-title">
                本级已绑定（{camerasOf(bindTarget.id).length}）
              </div>
              {camerasOf(bindTarget.id).length === 0 ? (
                <p className="detail">本级暂无摄像头</p>
              ) : (
                <ul className="bind-list">
                  {camerasOf(bindTarget.id).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="bind-link"
                        title="跳到视频监控查看该摄像头"
                        onClick={() => goCamera(c)}
                      >
                        {c.name}
                      </button>
                      <span className={`status-pill status-${c.status}`}>{c.status}</span>
                      <button
                        type="button"
                        className="danger"
                        disabled={bindBusy}
                        onClick={() => unbindCamera(c)}
                      >
                        解绑
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bind-sec">
              <div className="bind-sec-title">可绑定的摄像头</div>
              {cameras.filter((c) => c.regionId !== bindTarget.id).length === 0 ? (
                <p className="detail">没有其他摄像头可绑定</p>
              ) : (
                <ul className="bind-list">
                  {cameras
                    .filter((c) => c.regionId !== bindTarget.id)
                    .map((c) => (
                      <li key={c.id}>
                        <span className="bind-name">{c.name}</span>
                        <span className="detail">
                          {c.regionId == null ? '未分配' : pathOf(c.regionId)}
                        </span>
                        <button type="button" disabled={bindBusy} onClick={() => bindCamera(c)}>
                          绑定到此
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {(bindMsg || bindErr) && (
              <p className="detail" style={{ color: bindErr ? '#f87171' : '#34d399' }}>
                {bindErr || bindMsg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
