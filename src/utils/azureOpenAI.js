import axios from 'axios'
import { getSettings } from './storage'

const DEFAULT_AZURE_PROXY_BASE_URL = 'http://localhost:3000'
const AZURE_PROXY_ENDPOINT_BASE = '/azure-openai'
let azureSessionId = null
let unloadHandlerAttached = false

const resolveForwardedAzureProxyUrl = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const { protocol, hostname, port } = window.location

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3000`
  }

  if (port) {
    return `${protocol}//${hostname}:3000`
  }

  const githubDevMatch = hostname.match(/^(.*-)(\d+)(\.app\.github\.dev)$/)
  if (githubDevMatch) {
    return `${protocol}//${githubDevMatch[1]}3000${githubDevMatch[3]}`
  }

  return null
}

const resolveAzureProxyBaseUrl = () => {
  // 1. Build-time env var (Codespaces dev mode)
  const configured = (process.env.REACT_APP_AZURE_PROXY_BASE_URL || '').trim()
  if (configured) return configured

  // 2. User-saved proxy URL from Settings (works when app is uploaded to DHIS2)
  try {
    const saved = localStorage.getItem('dhis2-ai-insights-settings')
    if (saved) {
      const settings = JSON.parse(saved)
      const saved_url = (settings.azureProxyUrl || '').trim().replace(/\/$/, '')
      if (saved_url) return saved_url
    }
  } catch (_) {}

  // 3. Auto-detect Codespaces / localhost
  const forwarded = resolveForwardedAzureProxyUrl()
  return forwarded || DEFAULT_AZURE_PROXY_BASE_URL
}

const toAzureErrorMessage = (error) => {
  const status = error?.response?.status
  const apiMessage = error?.response?.data?.error?.message || error?.response?.data?.message

  if (apiMessage) {
    return apiMessage
  }

  if (error?.code === 'ERR_NETWORK') {
    return 'Network/CORS error while calling the Azure proxy. Verify the proxy is running and reachable.'
  }

  if (status === 401) {
    return 'Azure session missing or expired. Re-enter credentials in Settings to create a new session.'
  }

  if (status === 403 || status === 503) {
    return 'Azure proxy is unavailable. Please verify the local proxy is running and try again.'
  }

  if (status === 404) {
    return 'Azure proxy endpoint not found. Verify the proxy server routes and base URL.'
  }

  if (status === 413) {
    return 'Request too large. Narrow period, org unit, or indicators.'
  }

  if (status === 429) {
    return 'Too many Azure requests in a short period. Please wait and try again.'
  }

  return error?.message || 'Failed to communicate with Azure proxy. Please check your configuration and try again.'
}

const attachUnloadCleanup = () => {
  if (unloadHandlerAttached || typeof window === 'undefined') {
    return
  }

  window.addEventListener('beforeunload', () => {
    if (!azureSessionId || typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return
    }

    const proxyBaseUrl = resolveAzureProxyBaseUrl()
    const payload = JSON.stringify({ azureSessionId })
    navigator.sendBeacon(
      `${proxyBaseUrl}${AZURE_PROXY_ENDPOINT_BASE}/session/clear`,
      new Blob([payload], { type: 'application/json' })
    )
  })

  unloadHandlerAttached = true
}

const validateAzureCredentialInput = (credentials) => {
  const endpoint = (credentials?.endpoint || '').trim()
  const deploymentName = (credentials?.deploymentName || '').trim()
  const apiVersion = (credentials?.apiVersion || '2024-02-15-preview').trim()
  const apiKey = (credentials?.apiKey || '').trim()

  if (!endpoint || !deploymentName || !apiVersion || !apiKey) {
    throw new Error('Azure endpoint, deployment name, API version, and API key are required.')
  }

  return { endpoint, deploymentName, apiVersion, apiKey }
}

export const hasAzureSession = () => Boolean(azureSessionId)

export const initializeAzureSession = async (credentials) => {
  const proxyBaseUrl = resolveAzureProxyBaseUrl()
  const validated = validateAzureCredentialInput(credentials)

  const response = await axios.post(
    `${proxyBaseUrl}${AZURE_PROXY_ENDPOINT_BASE}/session`,
    {
      endpoint: validated.endpoint,
      deploymentName: validated.deploymentName,
      apiVersion: validated.apiVersion,
      apiKey: validated.apiKey,
    },
    {
      headers: {
        'Content-Type': 'application/json',
      }
    }
  )

  azureSessionId = response.data?.azureSessionId || null
  attachUnloadCleanup()

  if (!azureSessionId) {
    throw new Error('Failed to initialize Azure session on proxy.')
  }

  return {
    azureSessionId,
    expiresAt: response.data?.expiresAt || null,
  }
}

export const clearAzureSession = async () => {
  if (!azureSessionId) {
    return
  }

  const proxyBaseUrl = resolveAzureProxyBaseUrl()

  try {
    await axios.delete(`${proxyBaseUrl}${AZURE_PROXY_ENDPOINT_BASE}/session`, {
      headers: {
        'X-Azure-Session-Id': azureSessionId,
      }
    })
  } finally {
    azureSessionId = null
  }
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
  const settings = getSettings() || {}
  const proxyBaseUrl = resolveAzureProxyBaseUrl()
  const maxTokens = settings.maxTokens || 2000
  const temperature = settings.temperature || 0.7

  if (!azureSessionId) {
    throw new Error('Azure session is not initialized. Configure Azure credentials in Settings and test connection first.')
  }

  // Prepare prompt with context and data
  const systemPrompt = createSystemPrompt(data, context)

  // Prepare conversation history
  const messages = [
    { role: 'system', content: systemPrompt }
  ]

  // Add conversation history (limited to last 3 messages to manage tokens)
  const recentConversation = conversation.slice(-3)
  messages.push(...recentConversation)

  // Add the current query
  messages.push({ role: 'user', content: query })

  try {
    const response = await axios.post(
      `${proxyBaseUrl}${AZURE_PROXY_ENDPOINT_BASE}/analyze`,
      {
        messages,
        max_tokens: maxTokens,
        temperature,
        n: 1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Azure-Session-Id': azureSessionId,
        }
      }
    )

    const aiMessage = response.data?.choices?.[0]?.message?.content || ''
    const recommendations = extractRecommendations(aiMessage)

    if (onStreamChunk && aiMessage) {
      onStreamChunk(aiMessage)
    }

    return {
      message: aiMessage,
      recommendations: recommendations.length > 0 ? recommendations : null,
      usage: response.data?.usage,
    }
  } catch (error) {
    console.error('Azure OpenAI API Error:', error.response?.data || error.message)

    // Check if it's a token limit error
    const responseErrorMessage = error.response?.data?.error?.message || error.response?.data?.message
    const fallbackMessage = toAzureErrorMessage(error)
    const errorMessage = responseErrorMessage || fallbackMessage
    if (errorMessage && errorMessage.includes('maximum context length')) {
      throw new Error(
        'Too much conversation history. Please click "Clear Chat" to start fresh and try your question again.'
      )
    }

    throw new Error(errorMessage)
  }
}

/**
 * Test the Azure OpenAI API connection
 * @param {Object} options - Connection options
 * @returns {Object} Test result
 */
export const testAzureOpenAIConnection = async (_options) => {
  const proxyBaseUrl = resolveAzureProxyBaseUrl()

  try {
    if (_options && (_options.endpoint || _options.deploymentName || _options.apiVersion || _options.apiKey)) {
      await initializeAzureSession(_options)
    }

    if (!azureSessionId) {
      throw new Error('Azure session is not initialized. Enter Azure credentials and test again.')
    }

    const response = await axios.get(`${proxyBaseUrl}${AZURE_PROXY_ENDPOINT_BASE}/test`, {
      headers: {
        'X-Azure-Session-Id': azureSessionId,
      }
    })

    return {
      success: true,
      message: response.data?.message || 'Successfully connected to Azure OpenAI proxy',
      expiresAt: response.data?.expiresAt || null,
    }
  } catch (error) {
    console.error('Azure OpenAI API Connection Test Error:', error.response?.data || error.message)
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