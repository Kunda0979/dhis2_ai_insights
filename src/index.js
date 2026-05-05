import React from 'react'
import ReactDOM from 'react-dom'
import { DataProvider } from '@dhis2/app-runtime'
import App from './App.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'
import './index.css'

const isLocalhostRuntime =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
const isCodespacesRuntime =
  typeof window !== 'undefined' &&
  (window.location.hostname.endsWith('.github.dev') ||
    window.location.hostname.endsWith('.app.github.dev'))
const isDevRuntime = isLocalhostRuntime || isCodespacesRuntime

const getAppConfig = () => ({
  baseUrl: isDevRuntime ? '.' : (process.env.REACT_APP_DHIS2_BASE_URL || '../../../'),
  apiVersion: process.env.REACT_APP_DHIS2_API_VERSION || '38',
})

const previewMode =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('preview')
    : null
const isSettingsPreview = isLocalhostRuntime && previewMode === 'settings'
const isStandalonePreview = isLocalhostRuntime && previewMode === 'standalone'

// ── Dev-only auth (Codespaces / localhost) ─────────────────────────────────
// Credentials are posted to the local proxy which injects Basic auth
// server-side for every /api/* request to DHIS2. When the app is uploaded
// to a real DHIS2 instance, isDevRuntime is false and this entire block is
// skipped — DHIS2 session cookies handle auth automatically.

const CREDS_KEY = 'DHIS2_CREDS'

const getStoredCreds = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CREDS_KEY) || window.sessionStorage.getItem(CREDS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_) { return null }
}

const getProxyBaseUrl = () => {
  const configured = (process.env.REACT_APP_AZURE_PROXY_BASE_URL || '').trim()
  if (configured) return configured
  if (typeof window === 'undefined') return null
  const { protocol, hostname } = window.location
  const match = hostname.match(/^(.*-)(\d+)(\.app\.github\.dev)$/)
  if (match) return `${protocol}//${match[1]}3000${match[3]}`
  return `${protocol}//${hostname}:3000`
}

const setProxyAuth = async (username, password) => {
  const proxyBaseUrl = getProxyBaseUrl()
  if (!proxyBaseUrl) return { ok: false, error: 'Proxy URL not available.' }
  try {
    const resp = await fetch(`${proxyBaseUrl}/dhis2-proxy/set-basic-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      return { ok: false, error: data?.error?.message || `HTTP ${resp.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const reinitProxy = async () => {
  const creds = getStoredCreds()
  if (!creds?.username || !creds?.password) return false
  const proxyBaseUrl = getProxyBaseUrl()
  if (!proxyBaseUrl) return false
  try {
    const statusResp = await fetch(`${proxyBaseUrl}/dhis2-proxy/auth-status`)
    if (statusResp.ok) {
      const data = await statusResp.json()
      if (data.authenticated) return true
    }
  } catch (_) {}
  const result = await setProxyAuth(creds.username, creds.password)
  return result.ok
}

const TARGET_SERVER =
  process.env.REACT_APP_DHIS2_DEV_PROXY_TARGET || 'https://play.im.dhis2.org/dev'

const DevLoginForm = ({ onLogin }) => {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) { setError('Username and password are required.'); return }
    setBusy(true); setError('')
    const result = await setProxyAuth(username, password)
    if (!result.ok) {
      setBusy(false)
      setError(result.error || 'Authentication failed.')
      return
    }
    window.localStorage.setItem(CREDS_KEY, JSON.stringify({ username, password }))
    window.sessionStorage.setItem(CREDS_KEY, JSON.stringify({ username, password }))
    setBusy(false)
    if (onLogin) onLogin()
  }

  return (
    <div style={{
      padding: 24, maxWidth: 400, margin: '60px auto', fontFamily: 'sans-serif',
      border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    }}>
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>Sign in to DHIS2</h2>
      <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Server: <strong>{TARGET_SERVER}</strong>
      </p>
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>Username</label>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)} autoFocus
          autoComplete="username"
          style={{ width: '100%', marginBottom: 12, padding: 8, boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 4 }} />
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ width: '100%', marginBottom: 16, padding: 8, boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 4 }} />
        {error && <p style={{ color: '#b91c1c', margin: '0 0 12px', fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={busy} style={{
          width: '100%', backgroundColor: busy ? '#6b7280' : '#0366d6',
          color: '#fff', border: 'none', padding: 10, borderRadius: 6,
          cursor: busy ? 'not-allowed' : 'pointer', fontSize: 15,
        }}>{busy ? 'Verifying…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

// ── Root ───────────────────────────────────────────────────────────────────

const Root = () => {
  const [status, setStatus] = React.useState(
    isDevRuntime && !isSettingsPreview && !isStandalonePreview ? 'initializing' : 'ready'
  )

  React.useEffect(() => {
    if (status !== 'initializing') return
    const creds = getStoredCreds()
    if (!creds) { setStatus('login'); return }
    reinitProxy().then(ok => setStatus(ok ? 'ready' : 'login'))
  }, [])

  if (isStandalonePreview) return <div style={{ padding: 16 }}><SettingsPanel onClose={() => {}} engine={null} /></div>
  if (status === 'initializing') return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#6b7280' }}>Connecting to DHIS2…</div>
  )
  if (status === 'login') return <DevLoginForm onLogin={() => setStatus('ready')} />
  return <DataProvider config={getAppConfig()}><App /></DataProvider>
}

ReactDOM.render(<React.StrictMode><Root /></React.StrictMode>, document.getElementById('root'))
