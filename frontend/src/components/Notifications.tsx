import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../auth'

type Message = {
  id: number
  username: string | null
  title: string
  content: string
  type: string
  link: string | null
  read: boolean
  createdAt: string | null
  alarmId: number | null
}

const POLL_MS = 10000

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

export default function Notifications() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Message[]>([])
  const [unread, setUnread] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const loadCount = async () => {
    const res = await api('/api/messages/unread-count')
    if (res.ok) {
      const d = await res.json()
      setUnread(d.count ?? 0)
    }
  }

  const loadList = async () => {
    const res = await api('/api/messages')
    if (res.ok) setList((await res.json()) as Message[])
  }

  // 轮询未读数，报警产生时实时提示
  useEffect(() => {
    loadCount()
    const t = setInterval(loadCount, POLL_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (open) loadList()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const markRead = async (id: number) => {
    await api('/api/messages/' + id + '/read', { method: 'PUT' })
    setList((l) => l.map((m) => (m.id === id ? { ...m, read: true } : m)))
    setUnread((u) => Math.max(0, u - 1))
  }

  const markAll = async () => {
    await api('/api/messages/read-all', { method: 'PUT' })
    setList((l) => l.map((m) => ({ ...m, read: true })))
    setUnread(0)
  }

  const goto = (m: Message) => {
    if (!m.read) markRead(m.id)
    setOpen(false)
    if (m.link) navigate(m.link)
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button className="notif-bell" onClick={() => setOpen((o) => !o)} aria-label="站内信">
        <BellIcon />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <span>站内信{unread > 0 ? `（${unread} 条未读）` : ''}</span>
            <button className="notif-link" onClick={markAll} disabled={unread === 0}>
              全部已读
            </button>
          </div>
          <div className="notif-body">
            {list.length === 0 && <div className="notif-empty">暂无消息</div>}
            {list.map((m) => (
              <div
                key={m.id}
                className={m.read ? 'notif-item' : 'notif-item unread'}
                onClick={() => goto(m)}
              >
                <div className="notif-item-title">
                  {!m.read && <span className="notif-dot" />}
                  <span>{m.title}</span>
                </div>
                <div className="notif-item-content">{m.content}</div>
                {m.createdAt && <div className="notif-item-time">{m.createdAt}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
