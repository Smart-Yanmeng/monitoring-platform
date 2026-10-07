import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getToken, setToken as storeToken, clearToken as clearStore, fetchMe, type Me } from './auth'

type AuthValue = {
  token: string | null
  me: Me | null
  /** 认证检查是否完成：完成前不渲染页面，避免未登录内容闪现 */
  booted: boolean
  signIn: (token: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())
  const [me, setMe] = useState<Me | null>(null)
  const [booted, setBooted] = useState(false)

  // 仅在 token 变化时重新校验身份，而不是在每次路由切换时触发，
  // 避免登录后路径在 / 与 /login 间来回跳转导致 setMe 永远不生效。
  useEffect(() => {
    let alive = true
    if (!token) {
      setMe(null)
      setBooted(true)
      return
    }
    fetchMe().then((m) => {
      if (alive) {
        setMe(m)
        setBooted(true)
      }
    })
    return () => {
      alive = false
    }
  }, [token])

  const signIn = (t: string) => {
    storeToken(t)
    setTokenState(t)
  }

  const signOut = () => {
    clearStore()
    setTokenState(null)
    setMe(null)
  }

  return (
    <AuthContext.Provider value={{ token, me, booted, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
