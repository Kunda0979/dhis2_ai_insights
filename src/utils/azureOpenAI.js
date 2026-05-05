import { getSettings } from './storage'
import { getProxyBaseUrl } from './proxyConfig'

// ── Security model ────────────────────────────────────────────────────────
// ALL Azure OpenAI calls go through the local AI proxy (ollama-proxy/proxy.js).
// The frontend NEVER holds an API key or calls Azure OpenAI directly.
//
// Session flow:
//  1. User enters credentials in Settings → frontend POSTs to proxy
//  2. Proxy validates, stores credentials in memory, returns a session ID
//  3. Frontend stores ONLY the session ID + proxy URL (no secrets)
//  4. All AI queries carry X-Azure-Session-Id; proxy looks up credentials
//     and forwards to Azure
//  5. Session expires after 30 minutes of inactivity (idle timer resets on
//     every query)
//
// Storage — no secrets at rest:
//  Deployed (DHIS2): /api/userDataStore/dhis2-ai-insights/azure-session
//  Dev mode:         sessionStorage (tab-scoped, cleared on close)
//  In-memory cache:  sessionCache   (synchronous, no I/O needed)

let sessionCache = null   // { sessionId: string, proxyUrl: string } — no secrets
let expireTimer = null
let idleExpiresAt = null  // in-memory only — not persisted

const SESSION_IDLE_MS = 30 * 60 * 1000 // 30 minutes of inactivity

// ── Environment detection ─────────────────────────────────────────────────

const isDevMode = () => {
  if (typeof window === 'undefined') return true
  const { hostname } = window.location
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.github.dev')
  )
}

// ── Dev fallback: sessionStorage ──────────────────────────────────────────
// Tab-scoped — cleared automatically when the tab/browser closes.

const DEV_SESSION_KEY = 'dhis2-ai-insights-azure-session'

const devGet = () => {
  try {
    const raw = sessionStorage.getItem(DEV_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_) { return null }
}
const devSave = (c) => {
  try { sessionStorage.setItem(DEV_SESSION_KEY, JSON.stringify(c)) } catch (_) {}
}
const devClear = () => {
  try { sessionStorage.removeItem(DEV_SESSION_KEY) } catch (_) {}
}

// ── DHIS2 User Data Store (deployed) ─────────────────────────────────────
// Stores ONLY { sessionId, proxyUrl } — zero secrets at rest.
// The app is installed at .../api/apps/AI-Insights/index.html so
// ../../../api resolves to the DHIS2 root API on the same origin.

const DS_NAMESPACE = 'dhis2-ai-insights'
const DS_KEY = 'azure-session'  // session ID only — not raw credentials
const dsUrl = () => `../../../api/userDataStore/${DS_NAMESPACE}/${DS_KEY}`

const dsGet = async () => {
  const resp = await fetch(dsUrl(), { credentials: 'include' })
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`DHIS2 userDataStore GET failed: HTTP ${resp.status}`)
  return resp.json()
}

const dsSave = async (data) => {
  // PUT updates an existing key; fall back to POST on first save
  let resp = await fetch(dsUrl(), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (resp.status === 404) {
    resp = await fetch(dsUrl(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body?.message || `DHIS2 userDataStore save failed: HTTP ${resp.status}`)
  }
}

const dsClear = async () => {
  const resp = await fetch(dsUrl(), { method: 'DELETE', credentials: 'include' })
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`DHIS2 userDataStore DELETE failed: HTTP ${resp.status}`)
  }
}

// Migration: remove old 'azure-creds' key that stored raw API keys (best-effort)
const dsClearLegacyCreds = () => {
  fetch(`../../../api/userDataStore/${DS_NAMESPACE}/azure-creds`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => {})
}

// ── Idle session timer ────────────────────────────────────────────────────
// Resets on every AI query. Session cleared only after 30 min of inactivity.

const resetIdleTimer = () => {
  if (expireTimer) clearTimeout(expireTimer)
  idleExpiresAt = new Date(Date.now() + SESSION_IDLE_MS).toISOString()
  expireTimer = setTimeout(async () => {
    expireTimer = null
    idleExpiresAt = null
    const session = sessionCache
    sessionCache = null
    // Notify the proxy to invalidate the server-side session
    if (session?.sessionId) {
      const proxyUrl = session.proxyUrl || getProxyBaseUrl()
      fetch(`${proxyUrl}/azure-openai/session`, {
        method: 'DELETE',
        headers: { 'X-Azure-Session-Id': session.sessionId },
      }).catch(() => {})
    }
    // Best-effort wipe of local session reference
    try {
      if (isDevMode()) devClear(); else await dsClear()
    } catch (_) {}
    console.info('[Azure] Session cleared after 30 minutes of inactivity.')
  }, SESSION_IDLE_MS)
}

/** Returns the ISO timestamp when the idle session will next expire, or null. */
export const getSessionExpiresAt = () => idleExpiresAt

// ── Public credential API ─────────────────────────────────────────────────

/**
 * Load the Azure session reference from storage and validate it with the proxy.
 * Call once at app startup to warm the in-memory cache.
 */
export const loadAzureCredentials = async () => {
  try {
    const stored = isDevMode() ? devGet() : await dsGet()

    // Migration guard: old format stored raw API key — clear it and require re-entry
    if (stored && (stored.apiKey || stored.endpoint)) {
      console.warn('[Azure] Clearing legacy credentials that contained secrets.')
      isDevMode() ? devClear() : dsClearLegacyCreds()
      if (!isDevMode()) await dsClear().catch(() => {})
      return null
    }

    if (!stored?.sessionId) {
      sessionCache = null
      return null
    }

    const proxyUrl = stored.proxyUrl || getProxyBaseUrl()

    // Validate the session is still alive on the proxy
    const testResp = await fetch(`${proxyUrl}/azure-openai/test`, {
      headers: { 'X-Azure-Session-Id': stored.sessionId },
    })

    if (!testResp.ok) {
      // Session expired or proxy unavailable — clear the stale reference
      isDevMode() ? devClear() : await dsClear().catch(() => {})
      sessionCache = null
      return null
    }

    sessionCache = { sessionId: stored.sessionId, proxyUrl }
    resetIdleTimer()
    return sessionCache
  } catch (e) {
    console.error('[Azure] Failed to load session:', e.message)
    sessionCache = null
    return null
  }
}

/**
 * Create a proxy session from the supplied credentials, then persist only
 * the session ID. The API key is NEVER stored locally — the proxy holds it.
 *
 * @param {Object} creds - { endpoint, deploymentName, apiVersion, apiKey, proxyUrl? }
 * @throws if the proxy is unreachable or rejects the credentials.
 */
export const saveAzureCredentials = async (creds) => {
  const proxyUrl = ((creds.proxyUrl || '').trim() || getProxyBaseUrl()).replace(/\/$/, '')

  const resp = await fetch(`${proxyUrl}/azure-openai/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint:       (creds.endpoint || '').trim(),
      deploymentName: (creds.deploymentName || '').trim(),
      apiVersion:     (creds.apiVersion || '2024-02-15-preview').trim(),
      apiKey:         (creds.apiKey || '').trim(),
    }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(
      body?.error?.message ||
      `Proxy session creation failed (HTTP ${resp.status}). Is the proxy running at ${proxyUrl}?`
    )
  }

  const { azureSessionId } = await resp.json()
  if (!azureSessionId) throw new Error('Proxy did not return a session ID.')

  const sessionData = { sessionId: azureSessionId, proxyUrl }
  sessionCache = sessionData
  resetIdleTimer()

  if (isDevMode()) {
    devSave(sessionData)
  } else {
    await dsSave(sessionData)
    dsClearLegacyCreds()  // remove any old key-bearing entry
  }
}

/**
 * Notify the proxy to invalidate the session and remove the local reference.
 */
export const clearAzureCredentials = async () => {
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null }
  const session = sessionCache
  sessionCache = null
  idleExpiresAt = null

  // Ask the proxy to destroy the server-side session (best-effort)
  if (session?.sessionId) {
    const proxyUrl = session.proxyUrl || getProxyBaseUrl()
    fetch(`${proxyUrl}/azure-openai/session`, {
      method: 'DELETE',
      headers: { 'X-Azure-Session-Id': session.sessionId },
    }).catch(() => {})
  }

  if (isDevMode()) {
    devClear()
  } else {
    await dsClear().catch(() => {})
  }
}

/** Returns the in-memory session reference (sync, no I/O, no secrets). */
export const getAzureCredentials = () => sessionCache

// ── Session status ────────────────────────────────────────────────────────

export const hasAzureSession = () => Boolean(sessionCache?.sessionId)

export const initializeAzureSession = async (credentials) => {
  await saveAzureCredentials(credentials)
  return { azureSessionId: sessionCache?.sessionId || null, expiresAt: null }
}

export const clearAzureSession = async () => {
  await clearAzureCredentials()
}

// ── Error formatting ──────────────────────────────────────────────────────

const toProxyErrorMessage = (error, status) => {
  if (
    error?.message?.includes('Failed to fetch') ||
    error?.message?.includes('NetworkError') ||
    error?.code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach the AI proxy server. Ensure the proxy is running and the Proxy URL in Settings is correct.'
  }
  if (status === 401 || status === 403) {
    return 'Azure session expired or access denied. Re-enter your credentials in Settings.'
  }
  if (status === 413) {
    return 'Request too large. Narrow the period, org unit, or indicators.'
  }
  if (status === 429) {
    return 'Too many requests. Please wait before sending more queries.'
  }
  if (status === 503) {
    return 'Azure AI is currently disabled by your administrator.'
  }
  if (status === 504) {
    return 'Azure OpenAI request timed out. Try a shorter query or check your Azure service status.'
  }
  return error?.message || 'Failed to communicate with the AI proxy. Check your proxy configuration.'
}

/**
 * Send a query to Azure OpenAI via the proxy.
 * @param {string} query - The user's query
 * @param {Object} data - The DHIS2 data to analyze
 * @param {Object} context - Additional context information
 * @param {Array} conversation - The conversation history
 * @param {Function} onStreamChunk - Optional callback for streaming response chunks
 * @returns {Object} The AI response
 */
export const sendToAzureOpenAI = async (query, data, context, conversation = [], onStreamChunk = null) => {
  // Reset idle timer — this counts as activity
  if (hasAzureSession()) resetIdleTimer()

  if (!hasAzureSession()) {
    throw new Error('Azure credentials not configured. Configure Azure OpenAI in Settings first.')
  }

  const { sessionId, proxyUrl } = sessionCache
  const settings = getSettings() || {}
  const maxTokens = settings.maxTokens || 2000
  const temperature = settings.temperature || 0.7

  const systemPrompt = createSystemPrompt(data, context)
  const messages = [{ role: 'system', content: systemPrompt }]
  messages.push(...conversation.slice(-3))
  messages.push({ role: 'user', content: query })

  try {
    const resp = await fetch(`${proxyUrl}/azure-openai/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Azure-Session-Id': sessionId,
      },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, n: 1 }),
    })

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      const msg = body?.error?.message || `Proxy returned HTTP ${resp.status}`
      if (msg.includes('maximum context length')) {
        throw new Error('Too much conversation history. Please click "Clear Chat" to start fresh and try your question again.')
      }
      // If the proxy says the session is gone, clear local state too
      if (resp.status === 401 || resp.status === 403) {
        sessionCache = null
        idleExpiresAt = null
      }
      throw Object.assign(new Error(msg), { status: resp.status })
    }

    const payload = await resp.json()
    const aiMessage = payload?.choices?.[0]?.message?.content || ''
    const recommendations = extractRecommendations(aiMessage)

    if (onStreamChunk && aiMessage) onStreamChunk(aiMessage)

    return {
      message: aiMessage,
      recommendations: recommendations.length > 0 ? recommendations : null,
      usage: payload?.usage,
    }
  } catch (error) {
    if (error.message.includes('Clear Chat')) throw error
    throw new Error(toProxyErrorMessage(error, error.status))
  }
}

/**
 * Test the Azure OpenAI connection via the proxy.
 * @param {Object} _options - Unused (kept for interface compatibility)
 * @returns {Object} Test result
 */
export const testAzureOpenAIConnection = async (_options) => {
  if (!hasAzureSession()) {
    throw new Error('Azure credentials not configured. Enter credentials in Settings first.')
  }

  // Counts as activity — reset idle timer
  if (sessionCache) resetIdleTimer()

  const { sessionId, proxyUrl } = sessionCache

  try {
    const resp = await fetch(`${proxyUrl}/azure-openai/test`, {
      headers: { 'X-Azure-Session-Id': sessionId },
    })

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw Object.assign(
        new Error(body?.message || body?.error?.message || `Proxy test failed: HTTP ${resp.status}`),
        { status: resp.status }
      )
    }

    const data = await resp.json()
    return {
      success: true,
      message: data.message || 'Successfully connected to Azure OpenAI.',
      expiresAt: null,
    }
  } catch (error) {
    throw new Error(toProxyErrorMessage(error, error.status))
  }
}

/**
 * Create system prompt with context and data
 * @param {Object} data - The DHIS2 data
 * @param {Object} context - Additional context
 * @returns {string} The system prompt
 */
const createSystemPrompt = (data, context) => {
  // Format data for the prompt
  let dataString = ''

  if (data && data.headers) {
    const headers = data.headers
    const rows = data.rows || []
    const hasData = data.hasData || rows.length > 0

    if (hasData) {
      // Create a sample of the data (first 5 rows to save tokens)
      const sample = rows.slice(0, 5)

      // Format as a table
      dataString = 'Data Sample:\n'

      // Map the data element IDs to names if available
      const mapDataElementName = (id) => {
        if (data.metaData && data.metaData.items && data.metaData.items[id]) {
          return data.metaData.items[id].name || id;
        }
        return id;
      };

      // Map period IDs to human-readable names
      const mapPeriodName = (id) => {
        if (data.metaData && data.metaData.items && data.metaData.items[id]) {
          return data.metaData.items[id].name || formatPeriodId(id);
        }
        return formatPeriodId(id);
      };

      // Helper function to format period IDs into readable format
      const formatPeriodId = (periodId) => {
        if (!periodId || typeof periodId !== 'string') return periodId;

        // Handle YYYYMM format (e.g., 202406 -> June 2024)
        if (periodId.match(/^\d{6}$/)) {
          const year = periodId.substring(0, 4);
          const month = parseInt(periodId.substring(4, 6));
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                            'July', 'August', 'September', 'October', 'November', 'December'];
          return `${monthNames[month - 1]} ${year}`;
        }

        // Handle YYYYQN format (e.g., 2024Q1 -> Q1 2024)
        if (periodId.match(/^\d{4}Q\d$/)) {
          const year = periodId.substring(0, 4);
          const quarter = periodId.substring(5, 6);
          return `Q${quarter} ${year}`;
        }

        // Handle YYYY format (e.g., 2024 -> Year 2024)
        if (periodId.match(/^\d{4}$/)) {
          return `Year ${periodId}`;
        }

        return periodId;
      };

      // Get the dx and pe indices from the headers
      const dxIndex = headers.findIndex(h => h.name === 'dx');
      const peIndex = headers.findIndex(h => h.name === 'pe');

      // Create a header row with readable names
      const headerRow = headers.map((h, i) => {
        if (i === dxIndex && dxIndex !== -1) {
          return 'Data Element';
        } else if (i === peIndex && peIndex !== -1) {
          return 'Period';
        }
        return h.column;
      }).join(',');

      dataString += headerRow + '\n';

      // Format each row with readable data element and period names
      sample.forEach(row => {
        const formattedRow = row.map((cell, i) => {
          if (i === dxIndex && dxIndex !== -1) {
            return mapDataElementName(cell);
          } else if (i === peIndex && peIndex !== -1) {
            return mapPeriodName(cell);
          }
          return cell;
        }).join(',');
        dataString += formattedRow + '\n';
      })

      if (rows.length > 5) {
        dataString += `... (and ${rows.length - 5} more rows)\n`
      }

      // Add summary statistics if available
      if (data.summary) {
        dataString += '\nSummary Statistics:\n'
        Object.entries(data.summary).forEach(([key, value]) => {
          if (key === 'orgUnitBreakdown') {
            // Skip org unit breakdown in general summary, handle separately
            return
          }
          dataString += `${key}: ${JSON.stringify(value)}\n`
        })

        // Add organization unit breakdown if available
        if (data.summary.orgUnitBreakdown) {
          dataString += '\nOrganization Unit Breakdown:\n'
          Object.entries(data.summary.orgUnitBreakdown).forEach(([orgUnit, ouData]) => {
            dataString += `\n${orgUnit}:\n`
            Object.entries(ouData).forEach(([dataElement, stats]) => {
              dataString += `  ${dataElement}: Mean=${stats.mean}, Min=${stats.min}, Max=${stats.max}, Count=${stats.count}\n`
            })
          })
        }

        // Add period breakdown for time series analysis
        if (data.summary.periodBreakdown) {
          dataString += '\nPeriod-by-Period Breakdown:\n'
          Object.entries(data.summary.periodBreakdown).forEach(([period, periodData]) => {
            dataString += `\n${period}:\n`
            Object.entries(periodData).forEach(([dataElement, stats]) => {
              dataString += `  ${dataElement}: Mean=${stats.mean}, Min=${stats.min}, Max=${stats.max}, Count=${stats.count}\n`
            })
          })
        }

        // Add time series data for trend analysis
        if (data.summary.timeSeriesData) {
          dataString += '\nTime Series Data (Chronological Order):\n'
          Object.entries(data.summary.timeSeriesData).forEach(([dataElement, timeSeries]) => {
            dataString += `\n${dataElement} over time:\n`
            timeSeries.forEach(point => {
              dataString += `  ${point.period}: ${point.value}\n`
            })
          })
        }
      }
    } else {
      dataString = 'No data available for the selected data elements in the specified period and location.\n\n' +
                   'Selected data elements: ' +
                   (data.dataElements && data.metaData && data.metaData.items
                     ? data.dataElements.map(id => data.metaData.items[id]?.name || 'Unknown Element').join(', ')
                     : 'Unknown') + '\n' +
                   'Period: ' + context.period + '\n' +
                   'Organization Unit: ' + (context.orgUnit.displayName || context.orgUnit.name || context.orgUnit.id) + '\n\n' +
                   'Note: This is likely because:\n' +
                   '- This is a development/test system without complete data\n' +
                   '- The specific combination of elements, period, and location has no records\n' +
                   '- The data elements may be new or not yet populated\n'
    }
  }

  return `
You are an AI assistant specialized in analyzing DHIS2 health data for healthcare professionals and decision-makers in resource-constrained settings. Your goal is to provide clear, actionable insights that can help save lives and improve health outcomes.

IMPORTANT: Never display technical identifiers (UIDs like "UsSUX0cpKsH") in your response. Always refer to data elements and organization units by their proper names.

## Context:
- Data Elements: ${Array.isArray(context.dataElements) ? context.dataElements.join(', ') : 'None selected'}
- Period: ${context.period}
- Organization Unit: ${context.orgUnit.displayName || context.orgUnit.name || "Selected organization unit"}
${context.orgUnit.level ? `- Organization Unit Level: ${context.orgUnit.level}` : ''}
${context.orgUnit.path ? `- Organization Unit Hierarchy: ${context.orgUnit.path.split('/').slice(1).join(' > ')}` : ''}
${context.multiOrgUnitMode ? `
- **MULTI-ORGANIZATION UNIT ANALYSIS ENABLED**
- Analysis Type: Comparative analysis across ${context.childOrgUnits.length} child organization units
- Child Organization Units: ${context.childOrgUnits.map(ou => ou.displayName || ou.name).join(', ')}
${context.childOrgUnits.length > 0 && context.childOrgUnits[0].level ? `- Child Org Unit Level: ${context.childOrgUnits[0].level}` : ''}
- Focus: Individual organization unit performance comparison and ranking` : ''}

## Your Task:
- Analyze the provided health data carefully and objectively
- Present clear, factual insights about trends, patterns, and anomalies
- Provide specific, actionable recommendations when appropriate
- Consider the context of low-resource settings, emergency situations, and limited time
- Format your response in a clear, readable way using markdown
- Be concise but comprehensive

## Data:
${dataString}

When formulating your response:
1. First analyze the data briefly to understand what it represents
2. If there is data available:
   - Provide key observations and trends in the data
   - **TIME SERIES ANALYSIS**: Look at the "Time Series Data" and "Period-by-Period Breakdown" sections to identify trends over time, seasonal patterns, peaks, and declines
   - **PERIOD COMPARISON**: When asked about which month/period has highest/lowest values, refer to the period breakdowns and time series data
   - Highlight any notable patterns, anomalies, or concerning indicators
   ${context.multiOrgUnitMode ? `   - **FOR MULTI-ORG UNIT ANALYSIS**: Compare performance across organization units, identify best and worst performers, highlight disparities and outliers
   - **RANKING AND COMPARISON**: When asked, provide clear rankings and identify specific organization units that need attention
   - **GEOGRAPHIC INSIGHTS**: Consider geographic or administrative factors that might explain differences between organization units` : ''}
   - Conclude with 2-5 specific, actionable recommendations
3. If there is NO data available:
   - Acknowledge the lack of data without being repetitive
   - Provide 2-3 BRIEF suggestions specific to the selected data elements about possible next steps
   - Avoid lengthy explanations about data collection in general
   - Do NOT assume problems with data collection - this is a development system and may simply not have data
4. Always use a professional, direct tone appropriate for healthcare contexts

Focus on delivering practical insights that can inform immediate decision-making in healthcare contexts, particularly in low-resource or emergency settings.

Remember:
1. Avoid showing technical details like UIDs (e.g., "UsSUX0cpKsH") in your analysis
2. If data element names aren't clear, refer to them by their position or general type (e.g., "the first disease," "disease type A")
3. Focus on the patterns and insights rather than the raw data representation
4. ALWAYS use the organization unit's display name (${context.orgUnit.displayName || context.orgUnit.name || "organization unit"}) in your responses, not the ID
`
}

/**
 * Extract recommendations from AI message
 * @param {string} message - The AI response message
 * @returns {Array} List of recommendations
 */
const extractRecommendations = (message) => {
  const recommendations = []

  // Look for sections that might contain recommendations
  const recommendationSections = [
    /## Recommendations\s+([\s\S]+?)(?=##|$)/i,
    /Recommendations:\s+([\s\S]+?)(?=##|$)/i,
    /I recommend\s+([\s\S]+?)(?=##|$)/i,
    /Actions to consider:\s+([\s\S]+?)(?=##|$)/i,
  ]

  for (const pattern of recommendationSections) {
    const match = message.match(pattern)
    if (match && match[1]) {
      // Extract recommendations as bullet points or numbered list
      const section = match[1].trim()

      // Try to match bullet points
      const bulletPoints = section.match(/[•\-\*]\s+([^\n]+)/g)
      if (bulletPoints) {
        bulletPoints.forEach(point => {
          recommendations.push(point.replace(/[•\-\*]\s+/, '').trim())
        })
        continue
      }

      // Try to match numbered list
      const numberedPoints = section.match(/\d+\.\s+([^\n]+)/g)
      if (numberedPoints) {
        numberedPoints.forEach(point => {
          recommendations.push(point.replace(/\d+\.\s+/, '').trim())
        })
        continue
      }

      // If no bullet points found, just use entire section
      if (recommendations.length === 0) {
        // Split by lines and filter empty lines
        const lines = section.split('\n').filter(line => line.trim())
        lines.forEach(line => {
          recommendations.push(line.trim())
        })
      }
    }
  }

  return recommendations
}