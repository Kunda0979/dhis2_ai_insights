import React from 'react'
import ReactDOM from 'react-dom'
import { DataProvider } from '@dhis2/app-runtime'
import App from './App.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'

import './index.css'

const AUTH_STORAGE_KEY = 'DHIS2_BASIC_AUTH'

const storedBaseUrl =
  typeof window !== 'undefined'
    ? window.localStorage.getItem('DHIS2_BASE_URL') || null
    : null

const isLocalhostRuntime =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost'

const isCodespacesRuntime =
  typeof window !== 'undefined' &&
  (window.location.hostname.endsWith('.github.dev') ||
    window.location.hostname.endsWith('.app.github.dev'))

const authBaseUrl = isLocalhostRuntime ? storedBaseUrl : null

if (typeof window !== 'undefined' && !window.__dhis2PatchedFetch) {
  const originalFetch = window.fetch.bind(window)

  window.fetch = (input, init = {}) => {
    const basicAuth =
      window.localStorage.getItem(AUTH_STORAGE_KEY) ||
      window.sessionStorage.getItem(AUTH_STORAGE_KEY)
    const requestUrl = typeof input === 'string' ? input : input?.url
    let isSameOriginApiRequest = false

    if (requestUrl) {
      try {
        const parsedUrl = new URL(requestUrl, window.location.origin)
        isSameOriginApiRequest =
          parsedUrl.origin === window.location.origin &&
          parsedUrl.pathname.startsWith('/api/')
      } catch (error) {
        isSameOriginApiRequest = false
      }
    }

    const shouldAttachAuth = Boolean(
      basicAuth &&
      requestUrl &&
      (isSameOriginApiRequest || (authBaseUrl && requestUrl.startsWith(authBaseUrl)))
    )

    if (!shouldAttachAuth) {
      return originalFetch(input, init)
    }

    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || undefined)
    headers.set('Authorization', basicAuth)

    return originalFetch(input, {
      ...init,
      headers,
    })
  }

  window.__dhis2PatchedFetch = true
}

const appConfig = {
  baseUrl: isLocalhostRuntime
    ? authBaseUrl || process.env.REACT_APP_DHIS2_BASE_URL || '../../../'
    : process.env.REACT_APP_DHIS2_BASE_URL || '../../../',
  apiVersion: process.env.REACT_APP_DHIS2_API_VERSION || '38',
}

const previewMode =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('preview')
    : null

const isLocalhostPreview =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost'

const isDevSettingsPreview = isLocalhostPreview && previewMode === 'settings'
const isDevStandalonePreview = isLocalhostPreview && previewMode === 'standalone'
const hasBasicAuth =
  typeof window !== 'undefined' &&
  Boolean(
    window.localStorage.getItem(AUTH_STORAGE_KEY) ||
      window.sessionStorage.getItem(AUTH_STORAGE_KEY)
  )

const hasConfiguredBaseUrl = Boolean(appConfig.baseUrl && appConfig.baseUrl !== '../../../')
const needsDevBootstrap =
  (isLocalhostRuntime || isCodespacesRuntime) &&
  !isDevSettingsPreview &&
  !isDevStandalonePreview &&
  (!hasConfiguredBaseUrl || !hasBasicAuth)

const DevLoginBootstrap = () => {
  const [baseUrl, setBaseUrl] = React.useState(authBaseUrl || 'https://play.im.dhis2.org/dev')
  const [username, setUsername] = React.useState('admin')
  const [password, setPassword] = React.useState('district')
  const [error, setError] = React.useState('')

  const handleSubmit = (event) => {
    event.preventDefault()

    const sanitizedBaseUrl = (baseUrl || '').trim().replace(/\/$/, '')
    if (!sanitizedBaseUrl.startsWith('http://') && !sanitizedBaseUrl.startsWith('https://')) {
      setError('Please enter a valid DHIS2 URL including http:// or https://')
      return
    }

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    window.localStorage.setItem('DHIS2_BASE_URL', sanitizedBaseUrl)
    const encodedAuth = `Basic ${window.btoa(`${username}:${password}`)}`
    window.localStorage.setItem(AUTH_STORAGE_KEY, encodedAuth)
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, encodedAuth)
    window.location.reload()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '640px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginBottom: '8px' }}>Connect to DHIS2</h2>
      <p style={{ marginTop: 0, marginBottom: '16px' }}>
        Configure a DHIS2 server and credentials for development login.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="dhis2-base-url" style={{ display: 'block', marginBottom: '6px' }}>
          DHIS2 Base URL
        </label>
        <input
          id="dhis2-base-url"
          type="text"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          style={{ width: '100%', marginBottom: '12px', padding: '8px' }}
          placeholder="https://play.im.dhis2.org/dev"
        />

        <label htmlFor="dhis2-username" style={{ display: 'block', marginBottom: '6px' }}>
          Username
        </label>
        <input
          id="dhis2-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          style={{ width: '100%', marginBottom: '12px', padding: '8px' }}
          autoComplete="username"
        />

        <label htmlFor="dhis2-password" style={{ display: 'block', marginBottom: '6px' }}>
          Password
        </label>
        <input
          id="dhis2-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{ width: '100%', marginBottom: '12px', padding: '8px' }}
          autoComplete="current-password"
        />

        {error && (
          <p style={{ color: '#b91c1c', marginTop: 0, marginBottom: '12px' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          style={{
            backgroundColor: '#0366d6',
            color: '#fff',
            border: 'none',
            padding: '10px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Save and Continue
        </button>
      </form>
    </div>
  )
}

ReactDOM.render(
  <React.StrictMode>
    {isDevStandalonePreview ? (
      <div style={{ padding: '16px' }}>
        <p style={{ marginBottom: '12px' }}>
          Developer standalone preview mode. DHIS2 auth and runtime are fully bypassed.
        </p>
        <SettingsPanel onClose={() => {}} engine={null} />
      </div>
    ) : needsDevBootstrap ? (
      <DevLoginBootstrap />
    ) : isDevSettingsPreview ? (
      <App />
    ) : (
      <DataProvider config={appConfig}>
        <App />
      </DataProvider>
    )}
  </React.StrictMode>,
  document.getElementById('root')
)