import { getSettings } from './storage'

// ── Credential storage ────────────────────────────────────────────────────
// When deployed inside DHIS2: credentials are stored in the DHIS2 User Data
// Store (/api/userDataStore). Access requires a valid DHIS2 session — the API
// key never touches localStorage and is protected by DHIS2 authentication.
//
// In dev mode (localhost / github.dev): sessionStorage is used as a fallback.
// sessionStorage is cleared when the tab closes, limiting exposure.
//
// An in-memory cache (`credentialCache`) is maintained for the current page
// session so AI query calls don't need to hit the server each time.

let credentialCache = null
let expireTimer = null
let idleExpiresAt = null // in-memory only — not persisted

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
// The app is installed at .../api/apps/AI-Insights/index.html so
// ../../../api resolves to the DHIS2 root API on the same origin.

const DS_NAMESPACE = 'dhis2-ai-insights'
const DS_KEY = 'azure-creds'
const dsUrl = () => `../../../api/userDataStore/${DS_NAMESPACE}/${DS_KEY}`

const dsGet = async () => {
  const resp = await fetch(dsUrl(), { credentials: 'include' })
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`DHIS2 userDataStore GET failed: HTTP ${resp.status}`)
  return resp.json()
}

const dsSave = async (creds) => {
  // PUT updates an existing key; fall back to POST if key does not yet exist
  let resp = await fetch(dsUrl(), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (resp.status === 404) {
    resp = await fetch(dsUrl(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
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

// ── Idle session timer ───────────────────────────────────────────────────
// The timer resets on every AI query. Credentials are only wiped if the app
// sits idle (no queries sent) for 30 minutes.

const resetIdleTimer = () => {
  if (expireTimer) clearTimeout(expireTimer)
  idleExpiresAt = new Date(Date.now() + SESSION_IDLE_MS).toISOString()
  expireTimer = setTimeout(async () => {
    expireTimer = null
    idleExpiresAt = null
    credentialCache = null
    // Best-effort wipe from storage
    try {
      if (isDevMode()) devClear(); else await dsClear()
    } catch (_) {}
    console.info('[Azure] Session cleared after 30 minutes of inactivity.')
  }, SESSION_IDLE_MS)
}

/** Returns the ISO timestamp when the idle session will expire, or null. */
export const getSessionExpiresAt = () => idleExpiresAt

// ── Public credential API ─────────────────────────────────────────────────

/**
 * Load credentials from server (DHIS2 userDataStore or sessionStorage in dev).
 * Call once at app startup to warm the in-memory cache.
 */
export const loadAzureCredentials = async () => {
  try {
    const stored = isDevMode() ? devGet() : await dsGet()
    if (!stored) {
      credentialCache = null
      return null
    }
    credentialCache = stored
    // Start a fresh idle window — user just opened the app
    resetIdleTimer()
    return stored
  } catch (e) {
    console.error('[Azure] Failed to load credentials:', e.message)
    credentialCache = null
    return null
  }
}

/**
 * Validate, persist, and cache credentials.
 * Throws if validation fails or the server write fails.
 */
export const saveAzureCredentials = async (creds) => {
  const validated = validateCredentials(creds)
  // Do not store an expiresAt — expiry is idle-based and tracked in memory only
  credentialCache = validated
  resetIdleTimer()
  if (isDevMode()) {
    devSave(validated)
  } else {
    await dsSave(validated)
  }
}

/**
 * Wipe credentials from cache and storage.
 */
export const clearAzureCredentials = async () => {
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null }
  credentialCache = null
  idleExpiresAt = null
  if (isDevMode()) {
    devClear()
  } else {
    await dsClear()
  }
}

/** Returns the in-memory cached credentials (sync, no I/O). */
export const getAzureCredentials = () => credentialCache

// ── Validation ────────────────────────────────────────────────────────────

const normalizeEndpoint = (value) => {
  const raw = (value || '').trim().replace(/\/$/, '')
  try {
    const parsed = new URL(raw)
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
    return parsed.origin
  } catch (_) { return null }
}

const validateCredentials = (input = {}) => {
  const endpoint = normalizeEndpoint(input.endpoint)
  const deploymentName = (input.deploymentName || '').trim()
  const apiVersion = (input.apiVersion || '2024-02-15-preview').trim()
  const apiKey = (input.apiKey || '').trim()
  if (!endpoint || !deploymentName || !apiVersion || !apiKey) {
    throw new Error('Azure endpoint, deployment name, API version, and API key are all required.')
  }
  return { endpoint, deploymentName, apiVersion, apiKey }
}

// ── Error formatting ──────────────────────────────────────────────────────

const toAzureErrorMessage = (error) => {
  const status = error?.status || error?.response?.status
  const apiMessage = error?.response?.data?.error?.message || error?.response?.data?.message

  if (apiMessage) return apiMessage

  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError') || error?.code === 'ERR_NETWORK') {
    return 'Network/CORS error reaching Azure OpenAI. Check your endpoint URL and that your Azure resource is accessible from this browser.'
  }

  if (status === 401) {
    return 'Azure API key is invalid or expired. Re-enter your credentials in Settings.'
  }

  if (status === 403) {
    return 'Access denied. Check your Azure API key permissions.'
  }

  if (status === 404) {
    return 'Azure deployment not found. Check the endpoint URL and deployment name.'
  }

  if (status === 413) {
    return 'Request too large. Narrow period, org unit, or indicators.'
  }

  if (status === 429) {
    return 'Too many Azure requests in a short period. Please wait and try again.'
  }

  return error?.message || 'Failed to communicate with Azure OpenAI. Check your configuration in Settings.'
}

// ── Direct Azure call helper ───────────────────────────────────────────────

const callAzure = async (creds, body) => {
  const { endpoint, deploymentName, apiVersion, apiKey } = creds
  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  })
}

// ── Public session API ────────────────────────────────────────────────────

export const hasAzureSession = () => {
  if (!credentialCache) return false
  if (credentialCache.expiresAt && new Date(credentialCache.expiresAt).getTime() <= Date.now()) return false
  return true
}

export const initializeAzureSession = async (credentials) => {
  await saveAzureCredentials(credentials)
  return { azureSessionId: 'browser-direct', expiresAt: null }
}

export const clearAzureSession = async () => {
  await clearAzureCredentials()
}

/**
 * Send a query to Azure OpenAI API
 * @param {string} query - The user's query
 * @param {Object} data - The DHIS2 data to analyze
 * @param {Object} context - Additional context information
 * @param {Array} conversation - The conversation history
 * @param {Function} onStreamChunk - Optional callback for streaming response chunks
 * @returns {Object} The AI response
 */
export const sendToAzureOpenAI = async (query, data, context, conversation = [], onStreamChunk = null) => {
  // Reset the idle timer — this counts as activity
  if (hasAzureSession()) resetIdleTimer()

  if (!hasAzureSession()) {
    throw new Error(
      credentialCache?.expiresAt
        ? 'Azure session has expired (30 minutes). Re-enter your credentials in Settings.'
        : 'Azure credentials not configured. Configure Azure OpenAI in Settings first.'
    )
  }
  const creds = credentialCache

  const settings = getSettings() || {}
  const maxTokens = settings.maxTokens || 2000
  const temperature = settings.temperature || 0.7

  const systemPrompt = createSystemPrompt(data, context)
  const messages = [{ role: 'system', content: systemPrompt }]
  messages.push(...conversation.slice(-3))
  messages.push({ role: 'user', content: query })

  try {
    const resp = await callAzure(creds, { messages, max_tokens: maxTokens, temperature, n: 1 })

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      const msg = body?.error?.message || `Azure returned HTTP ${resp.status}`
      if (msg.includes('maximum context length')) {
        throw new Error('Too much conversation history. Please click "Clear Chat" to start fresh and try your question again.')
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
    throw new Error(toAzureErrorMessage(error))
  }
}

/**
 * Test the Azure OpenAI API connection
 * @param {Object} options - Connection options
 * @returns {Object} Test result
 */
export const testAzureOpenAIConnection = async (_options) => {
  // Credentials must already be saved (via saveAzureCredentials) before calling this.
  // Counts as activity — reset the idle timer.
  if (credentialCache) resetIdleTimer()
  const creds = credentialCache
  if (!creds) {
    throw new Error('Azure credentials not configured. Enter credentials in Settings first.')
  }

  try {
    const resp = await callAzure(creds, {
      messages: [{ role: 'user', content: 'Connection test' }],
      max_tokens: 10,
      temperature: 0,
    })

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}))
      throw Object.assign(
        new Error(body?.error?.message || `HTTP ${resp.status}`),
        { status: resp.status }
      )
    }

    return {
      success: true,
      message: 'Successfully connected to Azure OpenAI.',
      expiresAt: null,
    }
  } catch (error) {
    throw new Error(toAzureErrorMessage(error))
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