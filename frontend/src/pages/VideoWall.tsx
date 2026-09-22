import { useMemo, useRef, useState } from 'react'

type FightAlarm = { id: number; location: string; time: string }
type Camera = { id: number; name: string }
type LayoutKey = '4' | '9' | '16'

const LAYOUT_COLS: Record<LayoutKey, number> = { '4': 2, '9': 3, '16': 4 }
const LAYOUT_LABEL: Record<LayoutKey, string> = { '4': '四画面', '9': '九画面', '16': '十六画面' }

// 打架报警（前端演示数据，后续替换为后端接口）
const MOCK_ALARMS: FightAlarm[] = [
  { id: 1, location: '第五社区 > 3号楼大厅', time: '2026-09-23 10:38:07' },
  { id: 2, location: '第五社区 > 地下车库入口', time: '2026-09-23 09:59:05' },
  { id: 3, location: '校部 > 篮球场西侧', time: '2026-09-23 09:12:41' },
  { id: 4, location: '第五社区 > 5号楼走廊', time: '2026-09-22 22:17:33' },
  { id: 5, location: '校部 > 食堂北门', time: '2026-09-22 21:06:58' },
  { id: 6, location: '第五社区 > 围墙南段', time: '2026-09-22 20:44:12' },
  { id: 7, location: '校部 > 地下车库 B 区', time: '2026-09-22 19:30:27' },
  { id: 8, location: '第五社区 > 1号楼大厅', time: '2026-09-22 18:15:03' },
]

const CAMERA_NAMES = [
  '306网络摄像机', '312网络摄像机', '一楼枪机-东侧', '一楼半球',
  '二楼枪机-西侧', '205网络摄像机', '3F半球', '机房枪机',
  '围墙枪机-南', '围墙枪机-北', '大门口枪机', '停车场半球',
  '401网络摄像机', '409网络摄像机', '501吸顶机', '516吸顶机',
]

function buildCameras(): Camera[] {
  return CAMERA_NAMES.map((name, i) => ({
    id: i + 1,
    name: `校部 > 第五社区 > ${name}`,
  }))
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  )
}

export default function VideoWall() {
  const [layout, setLayout] = useState<LayoutKey>('4')
  const [page, setPage] = useState(1)
  const [fontColor, setFontColor] = useState('#e6edf3')
  const [tileBg, setTileBg] = useState('#0a0a0a')
  const gridRef = useRef<HTMLDivElement>(null)

  const cameras = useMemo(buildCameras, [])
  const cols = LAYOUT_COLS[layout]
  const visible = cameras.slice(0, cols * cols)

  const pageSize = 6
  const totalPages = Math.max(1, Math.ceil(MOCK_ALARMS.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const alarms = MOCK_ALARMS.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleFullscreen = () => {
    const el = gridRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }

  return (
    <div className="video-wall">
      <div className="vw-body">
        {/* 左侧：打架报警列表 */}
        <aside className="vw-alarms">
          <div className="vw-alarms-head">
            <span className="vw-dot" />
            打架报警
            <span className="vw-count">{MOCK_ALARMS.length}</span>
          </div>
          <div className="vw-alarm-list">
            {alarms.map((a) => (
              <div className="vw-alarm-item" key={a.id}>
                <div className="vw-alarm-loc">{a.location}</div>
                <div className="vw-alarm-time">{a.time}</div>
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
            {visible.map((cam) => (
              <figure className="vw-tile" key={cam.id} style={{ background: tileBg }}>
                <CameraIcon />
                <figcaption className="vw-tile-label" style={{ color: fontColor }}>
                  {cam.name}
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="vw-toolbar">
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
