import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, getToken } from '../auth'
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

type RegionLite = { id: number; name: string; parentId: number | null }

type LayoutKey = '4' | '9' | '16'

const LAYOUT_COLS: Record<LayoutKey, number> = { '4': 2, '9': 3, '16': 4 }
const LAYOUT_LABEL: Record<LayoutKey, string> = { '4': '四画面', '9': '九画面', '16': '十六画面' }
const LEVEL_LABEL: Record<string, string> = { INFO: '提示', WARNING: '警告', CRITICAL: '严重' }

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  )
}

/**
 * 单路摄像头画面：MJPEG over HTTP（multipart/x-mixed-replace）。
 *
 * <p>浏览器不能直接播 RTSP，后端把 AI 拉流线程解码到的最新帧以 MJPEG 推送，
 * 这里用一个 <img> 承载即可，无需任何播放器库。
 *
 * <p>无信号（设备未配置地址 / 拉流失败）时后端返回 204，此处展示占位；
 * 断流则按退避间隔自动重连。
 */
function CameraStream({
  deviceId,
  name,
  status,
  fontColor,
  fallback,
}: {
  deviceId: number
  name: string
  status: string
  fontColor: string
  fallback: React.ReactNode
}) {
  // 无信号时展示占位；设备明确 OFFLINE 时不反复重试
  const [dead, setDead] = useState(false)

  // 设备状态恢复为在线时重置，允许重新拉流
  useEffect(() => {
    if (status !== 'OFFLINE') setDead(false)
  }, [status])

  // 画面异常/断流时定期尝试恢复（设备可能稍后才拉起来）
  useEffect(() => {
    if (!dead || status === 'OFFLINE') return
    const t = setInterval(() => setDead(false), 5000)
    return () => clearInterval(t)
  }, [dead, status])

  if (dead) return <>{fallback}</>

  return (
    <img
      className="vw-stream"
      // 加时间戳避免浏览器缓存住失败的响应
      src={`/ai/camera/${deviceId}/mjpeg?t=${Date.now()}`}
      alt={name}
      style={{ color: fontColor }}
      onError={() => setDead(true)}
    />
  )
}

export default function VideoWall() {
  const navigate = useNavigate()
  const location = useLocation()
  const [layout, setLayout] = useState<LayoutKey>('4')
  const [page, setPage] = useState(1)
  const [fontColor, setFontColor] = useState('#e6edf3')
  const [tileBg, setTileBg] = useState('#0a0a0a')
  const gridRef = useRef<HTMLDivElement>(null)

  const [regions, setRegions] = useState<RegionLite[]>([])
  const [cameras, setCameras] = useState<Device[]>([])
  const [events, setEvents] = useState<AlarmEvent[]>([])
  const [selectedRegion, setSelectedRegion] = useState('')
  /** 从其他页（如地区管理）跳转过来时需要高亮的摄像头 id */
  const [focusId, setFocusId] = useState<number | null>(null)
  /** 已处理过的定位请求，避免 state 被清空后重复定位 */
  const handledFocus = useRef<number | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!getToken()) {
        navigate('/login')
        return
      }
      const [cr, rr, ar] = await Promise.all([
        api('/api/devices?type=CAMERA'),
        api('/api/regions'),
        api('/api/alarms?handled=false'),
      ])
      if (cr.status === 401 || rr.status === 401 || ar.status === 401) {
        navigate('/login')
        return
      }
      if (cr.ok) setCameras(await cr.json())
      if (rr.ok) setRegions(await rr.json())
      if (ar.ok) setEvents(await ar.json())
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 地区管理页跳转过来时（navigate('/', {state:{deviceId}})）自动定位到该摄像头：
  // 把筛选切到它所属地区，并高亮对应画面。
  // 注意必须等 cameras 加载完才能定位，故成功后才清 router state，
  // 否则 state 被提前清掉会导致后续 effect 拿不到 deviceId。
  useEffect(() => {
    const id = (location.state as { deviceId?: number } | null)?.deviceId
    if (typeof id !== 'number' || handledFocus.current === id) return
    const cam = cameras.find((c) => c.id === id)
    if (!cam) return
    handledFocus.current = id
    setFocusId(id)
    if (cam.regionId != null) {
      setSelectedRegion(String(cam.regionId))
      setPage(1)
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, cameras, navigate, location.pathname])

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

  // 选中地区时，包含其所有下级地区（便于按校区/楼栋查看全部摄像头/报警）
  const regionScope = useMemo(() => {
    if (!selectedRegion) return null
    const id = Number(selectedRegion)
    const scope = new Set<number>([id])
    const stack = [id]
    while (stack.length) {
      const pid = stack.pop()!
      for (const r of regions) {
        if (r.parentId === pid) {
          scope.add(r.id)
          stack.push(r.id)
        }
      }
    }
    return scope
  }, [selectedRegion, regions])

  const inScope = (regionId: number | null) =>
    regionScope == null ? true : regionId != null && regionScope.has(regionId)

  const visibleCameras = cameras.filter((c) => inScope(c.regionId))
  const visibleEvents = events.filter((e) => inScope(e.regionId))

  const cols = LAYOUT_COLS[layout]
  const gridCameras = visibleCameras.slice(0, cols * cols)

  const pageSize = 6
  const totalPages = Math.max(1, Math.ceil(visibleEvents.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageEvents = visibleEvents.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleFullscreen = () => {
    const el = gridRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }

  return (
    <div className="video-wall">
      <div className="vw-body">
        {/* 左侧：实时未处理报警（按地区） */}
        <aside className="vw-alarms">
          <div className="vw-alarms-head">
            <span className="vw-dot" />
            实时报警
            <span className="vw-count">{visibleEvents.length}</span>
          </div>
          <div className="vw-alarm-list">
            {pageEvents.length === 0 && (
              <div className="vw-alarm-item">
                <div className="vw-alarm-loc">暂无未处理报警</div>
              </div>
            )}
            {pageEvents.map((a) => (
              <div className="vw-alarm-item" key={a.id}>
                <div className="vw-alarm-loc">
                  <span className={`vw-level vw-level-${a.level.toLowerCase()}`}>
                    {LEVEL_LABEL[a.level] ?? a.level}
                  </span>
                  {a.reason}
                </div>
                <div className="vw-alarm-time">
                  {a.regionId == null ? '未分配' : regionPath(a.regionId) || a.regionName}
                  {' · '}
                  {a.time}
                </div>
              </div>
            ))}
          </div>
          <div className="vw-alarm-pager">
            <button
              className="vw-pager-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="上一页"
            >
              ‹
            </button>
            <span>{safePage} / {totalPages}</span>
            <button
              className="vw-pager-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              aria-label="下一页"
            >
              ›
            </button>
          </div>
        </aside>

        {/* 右侧视频墙 */}
        <div className="vw-main">
          <div
            className="vw-grid"
            ref={gridRef}
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {gridCameras.length === 0 && (
              <div className="vw-empty">该地区暂无摄像头</div>
            )}
            {gridCameras.map((cam) => (
              <figure
                className={cam.id === focusId ? 'vw-tile vw-tile--focus' : 'vw-tile'}
                key={cam.id}
                style={{ background: tileBg }}
              >
                <CameraStream
                  deviceId={cam.id}
                  name={cam.name}
                  status={cam.status}
                  fontColor={fontColor}
                  fallback={
                    <div className="vw-tile-idle">
                      <CameraIcon />
                      <span>{cam.status === 'OFFLINE' ? '离线' : '无信号'}</span>
                    </div>
                  }
                />
                <figcaption className="vw-tile-label" style={{ color: fontColor }}>
                  {cam.name}
                </figcaption>
                <span className="vw-tile-sub" style={{ color: fontColor }}>
                  {cam.regionId == null ? '未分配' : regionPath(cam.regionId) || cam.regionName}
                </span>
              </figure>
            ))}
          </div>

          <div className="vw-toolbar">
            <Select
              className="vw-region-select"
              value={selectedRegion}
              onChange={(v) => {
                setSelectedRegion(v)
                setPage(1)
              }}
              options={[
                { value: '', label: '全部地区' },
                ...regions.map((r) => ({
                  value: String(r.id),
                  label: regionPath(r.id) || r.name,
                })),
              ]}
            />
            <button onClick={toggleFullscreen}>全屏播放</button>
            <label className="vw-color-label">
              字体颜色
              <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} />
            </label>
            <label className="vw-color-label">
              背景颜色
              <input type="color" value={tileBg} onChange={(e) => setTileBg(e.target.value)} />
            </label>
            <span className="vw-spacer" />
            {(['4', '9', '16'] as LayoutKey[]).map((k) => (
              <button
                key={k}
                className={layout === k ? 'vw-layout-btn active' : 'vw-layout-btn'}
                onClick={() => setLayout(k)}
              >
                {LAYOUT_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
