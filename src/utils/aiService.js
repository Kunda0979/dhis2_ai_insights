import { getSettings } from './storage'

/**
 * Sends a query to the configured AI provider (OpenAI, Azure OpenAI, or Ollama)
 * @param {string} query - The user's query
 * @param {Object} data - The DHIS2 data to analyze
 * @param {Object} context - Additional context information
 * @param {Array} conversation - The conversation history
 * @param {Function} onStreamChunk - Optional callback for streaming response chunks
 * @returns {Object} The AI response
 */
export const sendToAI = async (query, data, context, conversation = [], onStreamChunk = null) => {
  const settings = getSettings() || {}
  const aiProvider = settings.aiProvider || 'openai'

  // Based on the configured provider, send to appropriate service
  if (aiProvider === 'ollama') {
    const { sendToOllama } = await import('./ollama')
    return sendToOllama(query, data, context, conversation, onStreamChunk)
  } else if (aiProvider === 'azure-openai') {
    const { sendToAzureOpenAI } = await import('./azureOpenAI')
    return sendToAzureOpenAI(query, data, context, conversation, onStreamChunk)
  } else {
    // Default to OpenAI
    const { sendToOpenAI } = await import('./openai')
    return sendToOpenAI(query, data, context, conversation, onStreamChunk)
  }
}

/**
 * Tests connection to the configured AI provider
 * @param {Object} options - Connection options (apiKey for OpenAI or serverUrl for Ollama)
 * @param {string} provider - The provider to test ('openai' or 'ollama')
 * @returns {Object} Test result with available models
 */
export const testAIConnection = async (options, provider) => {
  if (!provider) {
    const settings = getSettings() || {}
    provider = settings.aiProvider || 'openai'
  }
  
  if (provider === 'openai') {
    // Import dynamically to avoid circular dependencies
    const { testOpenAIConnection } = await import('./openai')
    return testOpenAIConnection(options.apiKey)
  } else if (provider === 'ollama') {
    // Import dynamically to avoid circular dependencies
    const { testOllamaConnection } = await import('./ollama')
    return testOllamaConnection(options.serverUrl)
  } else if (provider === 'azure-openai') {
    // Import dynamically to avoid circular dependencies
    const { testAzureOpenAIConnection } = await import('./azureOpenAI')
    return testAzureOpenAIConnection(options)
  } else {
    throw new Error(`Unknown AI provider: ${provider}`)
  }
}

/**
 * Gets information about the current AI configuration
 * @returns {Object} Information about the configured AI provider
 */
export const getAIInfo = () => {
  const settings = getSettings() || {}
  const aiProvider = settings.aiProvider || 'openai'
  
  if (aiProvider === 'openai') {
    return {
      provider: 'openai',
      model: settings.model || 'gpt-4',
      temperature: settings.temperature || 0.7,
      maxTokens: settings.maxTokens || 2000
    }
  } else if (aiProvider === 'azure-openai') {
    return {
      provider: 'azure-openai',
      model: 'server-managed-deployment',
      resourceName: null,
      apiVersion: 'server-managed-version',
      maxTokens: settings.maxTokens || 2000
    }
  } else if (aiProvider === 'ollama') {
    return {
      provider: 'ollama',
      model: settings.ollamaModel || 'llama3',
      serverUrl: settings.ollamaServerUrl || 'http://localhost:11434',
      maxTokens: settings.maxTokens || 2000
    }
  }

  return {
    provider: 'unknown',
    model: 'not-configured'
  }
}