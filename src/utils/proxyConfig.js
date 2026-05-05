/**
 * Returns the base URL of the local AI proxy (ollama-proxy/proxy.js).
 *
 * Priority order:
 *  1. REACT_APP_AZURE_PROXY_BASE_URL — set at build/start time
 *     (e.g. in GitHub Codespaces the start-dev.sh script sets this to the
 *      forwarded Codespaces URL automatically)
 *  2. Auto-detected GitHub Codespaces hostname (port 3001)
 *  3. Same-protocol localhost:3001 (default for local dev)
 *
 * In production: set REACT_APP_AZURE_PROXY_BASE_URL to the URL of your
 * deployed proxy instance before building/deploying the app.
 */
export const getProxyBaseUrl = () => {
  const configured = (process.env.REACT_APP_AZURE_PROXY_BASE_URL || '').trim()
  if (configured) return configured

  if (typeof window === 'undefined') return 'http://localhost:3001'

  const { protocol, hostname } = window.location

  // GitHub Codespaces: hostname is like "abc-8080.app.github.dev"
  // Rewrite to port 3001 on the same Codespaces host
  const match = hostname.match(/^(.*-)(\d+)(\.app\.github\.dev)$/)
  if (match) return `${protocol}//${match[1]}3001${match[3]}`

  return `${protocol}//${hostname}:3001`
}
