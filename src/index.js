import React from 'react'
import ReactDOM from 'react-dom'
import { DataProvider } from '@dhis2/app-runtime'
import App from './App.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'

import './index.css'

const appConfig = {
  baseUrl: process.env.REACT_APP_DHIS2_BASE_URL || '../../../',
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

ReactDOM.render(
  <React.StrictMode>
    {isDevStandalonePreview ? (
      <div style={{ padding: '16px' }}>
        <p style={{ marginBottom: '12px' }}>
          Developer standalone preview mode. DHIS2 auth and runtime are fully bypassed.
        </p>
        <SettingsPanel onClose={() => {}} engine={null} />
      </div>
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