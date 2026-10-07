import { useEffect, useRef, useState } from 'react'
import { api } from '../auth'
import Select from '../components/Select'

type RegionLite = { id: number; name: string; parentId: number | null }

type DetectResult = {
  ok: boolean
  filename: string
  framesSampled: number
  maxScore: number
  isFight: boolean
  fightFrames: number
  threshold: number
  timeline: { t: number; score: number }[]
}

const LEVEL_LABEL: Record<string, string> = { INFO: '提示', WARNING: '警告', CRITICAL: '严重' }

/** 文件大小自适应单位，避免小文件显示成 0.00 MB */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 从失败响应里提取可读原因。
 * 后端 ResponseStatusException 的中文原因在 message/detail/error 任一字段，
 * 都取不到时回退为状态码，避免只显示「400」这种天书。
 */
async function readError(res: Response): Promise<string> {
  try {
    const raw = await res.text()
    if (!raw) return `HTTP ${res.status}`
    try {
      const d = JSON.parse(raw) as { message?: string; detail?: string; error?: string }
      return d.message || d.detail || d.error || `HTTP ${res.status}`
    } catch {
      return raw.slice(0, 200)
    }
  } catch {
    return `HTTP ${res.status}`
  }
}

export default function VideoDetect() {
  const [regions, setRegions] = useState<RegionLite[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  /** 正在转码的文件名，避免旧请求覆盖新选择 */
  const convertingName = useRef<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DetectResult | null>(null)

  const [alarmRegion, setAlarmRegion] = useState('')
  const [alarmLevel, setAlarmLevel] = useState('CRITICAL')
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null)
  /** 报警提示是否为成功（决定提示色，避免用字符串匹配判断） */
  const [alarmOk, setAlarmOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    api('/api/regions')
      .then((r) => {
        if (r.ok) r.json().then(setRegions)
      })
      .catch(() => {})
  }, [])

  // 选择文件时生成本地预览地址（blob URL），换文件/卸载时释放
  const pickFile = (f: File | null) => {
    setFile(f)
    setResult(null)
    setError(null)
    setAlarmMsg(null)
    setAlarmOk(false)
    setPreviewError(null)
    setPreviewNote(null)
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return f ? URL.createObjectURL(f) : null
    })
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  /**
   * 请求后端把视频转成浏览器可播的 MP4(H.264)。
   * 浏览器不支持 AVI 容器，但后端有 JavaCV(ffmpeg)，转码比前端引 wasm 更划算。
   */
  const transcodePreview = async (f: File) => {
    convertingName.current = f.name
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/ai/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        throw new Error(await readError(res))
      }
      const blob = await res.blob()
      // 期间用户可能已换文件，丢弃过期结果
      if (convertingName.current !== f.name) return
      const url = URL.createObjectURL(blob)
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
      // 记录是否真的转码了，便于提示用户
      const converted = res.headers.get('X-Preview-Converted') === 'true'
      const elapsed = res.headers.get('X-Preview-Elapsed-Ms')
      if (converted) {
        setPreviewNote(
          `原格式浏览器无法直接播放，已转为 MP4（耗时 ${(Number(elapsed) / 1000).toFixed(1)}s）`,
        )
      }
    } catch (e) {
      if (convertingName.current === f.name) {
        setPreviewError(
          '预览转换失败：' + (e instanceof Error ? e.message : String(e)) +
            '。仍可点击「开始识别」由服务端解析。',
        )
      }
    } finally {
      if (convertingName.current === f.name) {
        setPreviewLoading(false)
        convertingName.current = null
      }
    }
  }

  const onUpload = async () => {
    if (!file) {
      setError('请先选择要识别的视频文件')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setAlarmMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/ai/detect', { method: 'POST', body: fd })
      if (!res.ok) {
        setError('识别失败：' + (await readError(res)))
        return
      }
      const data = (await res.json()) as DetectResult
      setResult(data)
      setAlarmLevel(data.isFight ? 'CRITICAL' : 'WARNING')
    } catch (e) {
      setError('识别请求异常: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const raiseAlarm = async () => {
    if (!result) return
    setAlarmMsg(null)
    // 后端要求报警必须归属一个地区（见 AlarmService.raise），
    // 这里先本地拦截，避免白跑一趟请求只换来一个 400
    if (!alarmRegion) {
      setAlarmOk(false)
      setAlarmMsg('请先选择关联地区')
      return
    }
    const res = await api('/api/alarms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: null,
        regionId: Number(alarmRegion),
        reason: result.isFight ? '视频识别-打架' : '视频识别-疑似打架',
        level: alarmLevel,
      }),
    })
    if (res.ok) {
      setAlarmOk(true)
      setAlarmMsg('已生成报警记录')
    } else {
      setAlarmOk(false)
      setAlarmMsg('报警生成失败：' + (await readError(res)))
    }
  }

  return (
    <div>
      <h2>视频识别</h2>
      <p className="detail">
        上传一段监控视频，AI 服务会用已训练的打架检测模型逐帧分析，给出整体结论与分数时间轴。
      </p>

      {error && (
        <div className="detail" style={{ color: '#f85149' }}>
          {error}
        </div>
      )}

      <div className="card">
        <div className="menu-form">
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            style={{ flex: 1, minWidth: '12rem' }}
          />
          <button type="button" onClick={onUpload} disabled={loading}>
            {loading ? '识别中…' : '开始识别'}
          </button>
        </div>
        {file && !previewUrl && (
          <p className="detail">已选择：{file.name}（{formatSize(file.size)}）</p>
        )}
      </div>

      {previewUrl && (
        <div className="card" style={{ marginTop: '0.85rem' }}>
          <div className="vd-preview-head">
            <h4>视频预览</h4>
            {file && (
              <span className="detail">
                {file.name} · {formatSize(file.size)}
              </span>
            )}
          </div>
          {previewNote && (
            <p className="detail" style={{ marginBottom: '0.5rem' }}>{previewNote}</p>
          )}
          {previewError ? (
            <p className="detail" style={{ color: '#f87171' }}>{previewError}</p>
          ) : previewLoading ? (
            <div className="vd-preview vd-preview--busy">
              <p className="detail">正在转换为可播放格式…</p>
            </div>
          ) : (
            <video
              className="vd-preview"
              src={previewUrl}
              controls
              preload="metadata"
              onError={(e) => {
                // 仅在仍显示原始本地文件、且尚未转码过时触发一次，避免与转码结果互相触发
                const el = e.currentTarget
                if (file && !previewNote && el.dataset.transcoded !== '1') {
                  void transcodePreview(file)
                }
              }}
              onLoadedMetadata={(e) => {
                // 转码产物标记，避免其异常时再次触发转码
                if (previewNote) e.currentTarget.dataset.transcoded = '1'
              }}
            />
          )}
        </div>
      )}

      {loading && <p className="detail">正在抽帧推理，请稍候…</p>}

      {result && (
        <>
          <div className="card" style={{ marginTop: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '0.3rem 0.8rem',
                  borderRadius: 999,
                  fontWeight: 600,
                  background: result.isFight ? 'rgba(248,81,73,0.2)' : 'rgba(63,185,80,0.2)',
                  color: result.isFight ? '#f85149' : '#3fb950',
                  border: `1px solid ${result.isFight ? '#f85149' : '#3fb950'}`,
                }}
              >
                {result.isFight ? '检测到打架' : '未检测到打架'}
              </span>
              <span className="detail">最高置信度：{(result.maxScore * 100).toFixed(1)}%</span>
              <span className="detail">抽帧数：{result.framesSampled}</span>
              <span className="detail">打架帧：{result.fightFrames}</span>
              <span className="detail">阈值：{result.threshold}</span>
            </div>

            <h4 style={{ marginTop: '1rem' }}>分数时间轴（横轴=视频秒数，竖轴=打架置信度）</h4>
            <Timeline data={result.timeline} threshold={result.threshold} />
          </div>

          <div className="card" style={{ marginTop: '0.85rem' }}>
            <h4>标记为报警</h4>
            <div className="menu-form">
              <Select
                value={alarmRegion}
                onChange={setAlarmRegion}
                options={[
                  // 后端要求报警必须归属一个地区，故不提供「不关联地区」选项
                  { value: '', label: '请选择关联地区' },
                  ...regions.map((r) => ({ value: String(r.id), label: regionPath(r.id) || r.name })),
                ]}
              />
              <Select
                value={alarmLevel}
                onChange={setAlarmLevel}
                options={[
                  { value: 'INFO', label: LEVEL_LABEL.INFO },
                  { value: 'WARNING', label: LEVEL_LABEL.WARNING },
                  { value: 'CRITICAL', label: LEVEL_LABEL.CRITICAL },
                ]}
              />
              <button type="button" onClick={raiseAlarm}>
                生成报警
              </button>
            </div>
            {alarmMsg && (
              <p className="detail" style={{ color: alarmOk ? '#34d399' : '#f87171' }}>
                {alarmMsg}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Timeline({ data, threshold }: { data: { t: number; score: number }[]; threshold: number }) {
  if (!data.length) return null
  const W = 800
  const H = 140
  const pad = 8
  const barW = (W - pad * 2) / Math.max(data.length, 1)
  const maxT = data[data.length - 1].t || 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: '#0a0a0a', borderRadius: 8 }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="rgba(255,255,255,0.2)" />
      <line
        x1={pad}
        y1={H - pad - threshold * (H - pad * 2)}
        x2={W - pad}
        y2={H - pad - threshold * (H - pad * 2)}
        stroke="#f0883e"
        strokeDasharray="4 4"
      />
      {data.map((d, i) => {
        const h = Math.max(2, d.score * (H - pad * 2))
        const x = pad + i * barW
        const color = d.score >= threshold ? '#f85149' : '#3fb950'
        return <rect key={i} x={x} y={H - pad - h} width={Math.max(1, barW - 1)} height={h} fill={color} />
      })}
      <text x={pad} y={H - 1} fill="#8b949e" fontSize="10">
        0s
      </text>
      <text x={W - pad - 24} y={H - 1} fill="#8b949e" fontSize="10">
        {maxT.toFixed(0)}s
      </text>
    </svg>
  )
}
