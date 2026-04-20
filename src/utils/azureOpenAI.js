import axios from 'axios'
import { getApiKeyFromStorage, getSettings } from './storage'

const DEFAULT_AZURE_API_VERSION = '2024-02-15-preview'

const normalizeAzureEndpoint = (resourceInput) => {
  const raw = (resourceInput || '').trim()
  if (!raw) {
    return null
  }

  // Accept either a full endpoint URL or only the resource name
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw)
      return parsed.origin
    } catch (error) {
      return null
    }
  }

  return `https://${raw}.openai.azure.com`
}

const toAzureErrorMessage = (error) => {
  const status = error?.response?.status
  const apiMessage = error?.response?.data?.error?.message

  if (apiMessage) {
    return apiMessage
  }

  if (error?.code === 'ERR_NETWORK') {
    return 'Network/CORS error while calling Azure OpenAI. Verify endpoint URL, firewall rules, and allowed browser origins.'
  }

  if (status === 401 || status === 403) {
    return 'Authentication failed. Verify your Azure OpenAI API key and endpoint.'
  }

  if (status === 404) {
    return 'Deployment or endpoint not found. Verify the endpoint/resource name and deployment name.'
  }

  return error?.message || 'Failed to communicate with Azure OpenAI API. Please check your configuration and try again.'
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
  const apiKey = (getApiKeyFromStorage() || '').trim()
  if (!apiKey) {
    throw new Error('Azure OpenAI API key not configured')
  }

  // Get settings
  const settings = getSettings() || {}
  const endpoint = normalizeAzureEndpoint(settings.azureResourceName)
  const deploymentName = (settings.azureDeploymentName || '').trim()
  const apiVersion = (settings.azureApiVersion || DEFAULT_AZURE_API_VERSION).trim()
  const maxTokens = settings.maxTokens || 2000
  const temperature = settings.temperature || 0.7

  if (!endpoint || !deploymentName) {
    throw new Error('Azure OpenAI endpoint/resource name and deployment name must be configured')
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

  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`

  try {
    // If streaming is requested, use fetch API for SSE
    if (onStreamChunk) {
      return await handleStreamingResponse(
        url,
        {
          messages,
          max_tokens: maxTokens,
          temperature,
          n: 1,
          stream: true,
        },
        apiKey,
        onStreamChunk
      )
    } else {
      // Use regular axios for non-streaming requests
      const response = await axios.post(
        url,
        {
          messages,
          max_tokens: maxTokens,
          temperature,
          n: 1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          }
        }
      )

      // Extract the AI's message
      const aiMessage = response.data.choices[0].message.content

      // Process for recommendations (optional)
      const recommendations = extractRecommendations(aiMessage)

      // Create final response object
      const result = {
        message: aiMessage,
        recommendations: recommendations.length > 0 ? recommendations : null,
        usage: response.data.usage
      }

      return result
    }
  } catch (error) {
    console.error('Azure OpenAI API Error:', error.response?.data || error.message)

    // Check if it's a token limit error
    const errorMessage = error.response?.data?.error?.message || error.message
    if (errorMessage && errorMessage.includes('maximum context length')) {
      throw new Error(
        'Too much conversation history. Please click "Clear Chat" to start fresh and try your question again.'
      )
    }

    throw new Error(errorMessage || toAzureErrorMessage(error))
  }
}

/**
 * Handle streaming response from Azure OpenAI API
 * @param {string} url - The API endpoint URL
 * @param {Object} requestBody - The request body
 * @param {string} apiKey - The API key
 * @param {Function} onStreamChunk - Callback for streaming chunks
 * @returns {Object} The complete response
 */
const handleStreamingResponse = async (url, requestBody, apiKey, onStreamChunk) => {
  let fullMessage = ''
  let usage = null

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || 'Failed to communicate with Azure OpenAI API')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            break
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices[0]?.delta

            if (delta?.content) {
              fullMessage += delta.content
              onStreamChunk(delta.content)
            }

            // Capture usage info from the last chunk
            if (parsed.usage) {
              usage = parsed.usage
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue
          }
        }
      }
    }

    // Process for recommendations
    const recommendations = extractRecommendations(fullMessage)

    // Create final response object
    const result = {
      message: fullMessage,
      recommendations: recommendations.length > 0 ? recommendations : null,
      usage: usage
    }

    return result
  } catch (error) {
    console.error('Azure OpenAI Streaming Error:', error)

    // Check if it's a token limit error
    const errorMessage = error.message || ''
    if (errorMessage.includes('maximum context length')) {
      throw new Error(
        'Too much conversation history. Please click "Clear Chat" to start fresh and try your question again.'
      )
    }

    throw error
  }
}

/**
 * Test the Azure OpenAI API connection
 * @param {Object} options - Connection options
 * @returns {Object} Test result
 */
export const testAzureOpenAIConnection = async (options) => {
  const {
    apiKey,
    resourceName,
    deploymentName,
    apiVersion = DEFAULT_AZURE_API_VERSION,
  } = options

  const trimmedApiKey = (apiKey || '').trim()
  const endpoint = normalizeAzureEndpoint(resourceName)
  const trimmedDeployment = (deploymentName || '').trim()
  const trimmedVersion = (apiVersion || DEFAULT_AZURE_API_VERSION).trim()

  if (!trimmedApiKey || !endpoint || !trimmedDeployment) {
    throw new Error('Azure OpenAI API key, endpoint/resource name, and deployment name are required')
  }

  try {
    const url = `${endpoint}/openai/deployments/${trimmedDeployment}/chat/completions?api-version=${trimmedVersion}`

    await axios.post(
      url,
      {
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
        temperature: 0.7,
        n: 1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': trimmedApiKey
        }
      }
    )

    return {
      success: true,
      message: 'Successfully connected to Azure OpenAI API'
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
- User: ${context.user.name} (${context.user.username})
- Organization Units: ${context.user.orgUnits}
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