import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../auth'
import { useAuth } from '../authContext'

type Mode = 'login' | 'register'

// ── 内联图标（lucide 路径，避免额外依赖） ─────────────────────────
function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="auth-icon">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="auth-icon">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="auth-icon">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

/** 确定性伪随机星空，避免每次渲染闪动 */
function Stars({ count = 45 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37.7) % 100}%`,
        top: `${(i * 53.3) % 100}%`,
        size: 1 + ((i * 7) % 3),
        opacity: 0.12 + ((i * 13) % 55) / 100,
      })),
    [count],
  )
  return (
    <div className="auth-stars" aria-hidden="true">
      {stars.map((s, i) => (
        <span
          key={i}
          className="auth-star"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.opacity }}
        />
      ))}
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { token, signIn } = useAuth()
  // 被路由守卫重定向前的目标页，登录成功后跳回
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 已登录则直接进入系统
  useEffect(() => {
    if (token) navigate(from, { replace: true })
  }, [token, navigate, from])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOk(null)
    if (!username.trim()) return setError('请输入用户名')
    if (!password) return setError('请输入密码')
    if (mode === 'register' && password.length < 6) return setError('密码至少 6 位')

    setBusy(true)
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
    const res = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    })
    setBusy(false)

    if (mode === 'register') {
      if (res.ok) {
        setOk('注册成功，请登录')
        setMode('login')
        setPassword('')
      } else if (res.status === 409) {
        setError('用户名已存在')
      } else {
        setError('注册失败，请稍后再试')
      }
      return
    }
    if (!res.ok) {
      setError(res.status === 401 ? '用户名或密码错误' : '登录失败，请稍后再试')
      return
    }
    const data = (await res.json()) as { token: string }
    signIn(data.token)
    navigate(from, { replace: true })
  }

  return (
    <div className="auth-page">
      {/* ====== 中央网格装饰层（横跨左右两区） ====== */}
      <div className="auth-grid" aria-hidden="true">
        <div className="auth-grid-left" />
        <div className="auth-grid-right" />
      </div>

      {/* ====== 左侧品牌区 ====== */}
      <div className="auth-left">
        <div className="auth-circle auth-circle-l1" />
        <div className="auth-circle auth-circle-l2" />
        <div className="auth-left-content">
          <h1 className="auth-brand">MONITOR</h1>
          <p className="auth-slogan">轻量级系统监控与运维平台</p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon"><ActivityIcon /></div>
              <span>实时监控</span>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon"><ShieldIcon /></div>
              <span>安全可靠</span>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon"><UsersIcon /></div>
              <span>权限管控</span>
            </div>
          </div>
        </div>
      </div>

      {/* ====== 右侧表单区 ====== */}
      <div className="auth-right">
        <Stars />
        <div className="auth-panel">
          <div className="auth-card">
            <h2 className="auth-title">{mode === 'login' ? '欢迎回来' : '创建账号'}</h2>
            <p className="auth-subtitle">
              {mode === 'login' ? '登录您的监控平台账户' : '注册后即可开始使用监控平台'}
            </p>

            <form className="auth-form" onSubmit={submit} noValidate>
              <div className="auth-field">
                <label htmlFor="auth-username">用户名</label>
                <input
                  id="auth-username"
                  className="auth-input"
                  placeholder="请输入用户名"
                  value={username}
                  autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-password">密码</label>
                <input
                  id="auth-password"
                  className="auth-input"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div className="auth-error">
                  <span className="auth-error-dot">✕</span>
                  <span>{error}</span>
                </div>
              )}
              {ok && <div className="auth-ok">{ok}</div>}

              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? '处理中…' : mode === 'login' ? '登 录' : '注 册'}
              </button>
            </form>

            <div className="auth-switch">
              {mode === 'login' ? (
                <span>
                  没有账号？{' '}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => { setMode('register'); setError(null); setOk(null) }}
                  >
                    注册
                  </button>
                </span>
              ) : (
                <span>
                  已有账号？{' '}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => { setMode('login'); setError(null); setOk(null) }}
                  >
                    登录
                  </button>
                </span>
              )}
            </div>
          </div>

          <p className="auth-footer">© 2026 监控平台 · React 19 + Spring Boot 4</p>
        </div>
      </div>
    </div>
  )
}
