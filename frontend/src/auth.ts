const TOKEN_KEY = 'monitoring.token'

export type Me = { username: string; authorities: string[] }

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: 'Bearer ' + token } : {}
}

/** 统一请求封装：自动附带 JWT，遇 401 时清空本地 token */
export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders() },
  })
  if (res.status === 401) clearToken()
  return res
}

export async function fetchMe(): Promise<Me | null> {
  if (!getToken()) return null
  const res = await api('/api/auth/me')
  if (!res.ok) return null
  return (await res.json()) as Me
}
