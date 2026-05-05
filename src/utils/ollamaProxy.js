/**
 * Functions for handling Ollama API requests with DHIS2 compatibility
 */

import axios from 'axios'

// Configure the default timeout for all axios requests
axios.defaults.timeout = 120000 // 120 seconds

/**
 * Send a request to Ollama
 * @param {string} serverUrl - The base Ollama server URL
 * @param {string} endpoint - The API endpoint
 * @param {Object} options - Request options
 * @returns {Promise} The API response
 */
const ollamaRequest = async (serverUrl, endpoint, options = {}) => {
  // Default options - increased timeout to 120 seconds
  const defaultOptions = {
    method: 'GET',
    data: null,
    timeout: 120000 // 120 seconds for long running LLM requests
  }

  // Merge options
  const requestOptions = { ...defaultOptions, ...options }
  
  // Check if the URL ends with a slash and adjust if needed
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  const fullUrl = `${baseUrl}/${endpoint}`
  
  console.log(`Making request to: ${fullUrl}`)
  
  try {
    // Make the actual request with special handling for CORS
    const response = await axios({
      method: requestOptions.method,
      url: fullUrl,
      data: requestOptions.method === 'POST' ? requestOptions.data : undefined,
      timeout: requestOptions.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        // Add more headers as needed
      },
      // Explicitly allow CORS credentials
      withCredentials: false
    })

    return response.data
  } catch (error) {
    console.error('Ollama API Request Error:', error)

    // Different error messages for different error types
    if (error.code === 'ERR_NETWORK' || (error.message && error.message.includes('Network Error'))) {
      // Check if we're in a DHIS2 environment
      if (window.location.hostname.includes('dhis2.org') ||
          window.location.hostname.includes('play.im') ||
          window.location.pathname.includes('/api/apps/')) {
        throw new Error(
          `Cannot connect to Ollama at ${serverUrl} from DHIS2. Please use the proxy server:\n\n` +
          `1. Make sure Ollama is running on your computer\n` +
          `2. Navigate to the 'ollama-proxy' folder in the app directory\n` +
          `3. Run 'npm install' (first time only)\n` +
          `4. Run 'npm start' to start the proxy\n` +
          `5. Use http://localhost:3000 as your Ollama server URL`
        )
      } else {
        throw new Error(
          `Cannot connect to Ollama at ${serverUrl}. Is Ollama running?\n` +
          `Check that Ollama is running on your computer and try again.`
        )
      }
    }

    // Handle specific HTTP errors
    if (error.response) {
      throw new Error(
        `Ollama server at ${serverUrl} returned error ${error.response.status}: ${error.response.statusText}`
      )
    }

    // Generic error
    throw new Error(
      `Failed to connect to Ollama at ${serverUrl}. ${error.message}`
    )
  }
}

/**
 * Make a GET request to the Ollama API
 * @param {string} serverUrl - The Ollama server URL
 * @param {string} endpoint - The API endpoint
 * @returns {Promise} The API response
 */
export const ollamaGetRequest = async (serverUrl, endpoint) => {
  return ollamaRequest(serverUrl, endpoint, { method: 'GET' })
}

/**
 * Make a POST request to the Ollama API
 * @param {string} serverUrl - The Ollama server URL
 * @param {string} endpoint - The API endpoint
 * @param {Object} data - The request payload
 * @returns {Promise} The API response
 */
export const ollamaPostRequest = async (serverUrl, endpoint, data) => {
  return ollamaRequest(serverUrl, endpoint, { 
    method: 'POST',
    data
  })
}