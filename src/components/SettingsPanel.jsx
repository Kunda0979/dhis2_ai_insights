import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Button, 
  InputField, 
  Switch, 
  NoticeBox,
  Divider,
  ButtonStrip,
  CircularLoader,
  Box,
  SingleSelectField,
  SingleSelectOption,
  MultiSelectField,
  MultiSelectOption
} from '@dhis2/ui'
import { 
  saveApiKey, 
  getApiKeyFromStorage, 
  clearApiKey,
  saveSettings,
  getSettings
} from '../utils/storage'
import { testAIConnection } from '../utils/aiService'
import { clearAzureSession, hasAzureSession, loadAzureCredentials, saveAzureCredentials, clearAzureCredentials, getSessionExpiresAt } from '../utils/azureOpenAI'

export const SettingsPanel = ({ onClose, engine }) => {
  // OpenAI settings
  const [apiKey, setApiKey] = useState('')
  const [apiKeyMasked, setApiKeyMasked] = useState(true)
  
  // AI Provider selection
  const [aiProvider, setAIProvider] = useState('openai')

  // Azure credentials — form fields for entry only; API key is never stored client-side.
  // After saving, only the proxy session ID is persisted in DHIS2 userDataStore.
  const [azureEndpoint, setAzureEndpoint] = useState('')
  const [azureDeploymentName, setAzureDeploymentName] = useState('')
  const [azureApiVersion, setAzureApiVersion] = useState('2024-02-15-preview')
  const [azureApiKey, setAzureApiKey] = useState('')
  const [azureApiKeyMasked, setAzureApiKeyMasked] = useState(true)
  const [azureProxyUrl, setAzureProxyUrl] = useState(
    (process.env.REACT_APP_AZURE_PROXY_BASE_URL || '').trim()
  )
  const [azureSessionActive, setAzureSessionActive] = useState(false)
  const [azureSessionExpiresAt, setAzureSessionExpiresAt] = useState(null)

  // Ollama settings
  const [ollamaServerUrl, setOllamaServerUrl] = useState('http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState('llama3')
  const [availableOllamaModels, setAvailableOllamaModels] = useState([])
  
  // General settings
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [maxTokens, setMaxTokens] = useState(2000)
  const [temperature, setTemperature] = useState(0.7)
  const [model, setModel] = useState('gpt-4')
  const [cachingEnabled, setCachingEnabled] = useState(true)

  useEffect(() => {
    // Load API key from storage
    const storedApiKey = getApiKeyFromStorage() || ''
    setApiKey(storedApiKey)
    
    // Load other settings
    const settings = getSettings()
    if (settings) {
      setMaxTokens(settings.maxTokens || 2000)
      setTemperature(settings.temperature || 0.7)
      setModel(settings.model || 'gpt-4')
      setCachingEnabled(settings.cachingEnabled !== false)
      
      // Load AI provider settings
      setAIProvider(settings.aiProvider || 'openai')
      setOllamaServerUrl(settings.ollamaServerUrl || 'http://localhost:11434')
      setOllamaModel(settings.ollamaModel || 'llama3')
    }

    // Restore Azure session: loads proxy session ID and validates with the proxy.
    // Credentials (incl. API key) are NOT returned — they live only in proxy memory.
    loadAzureCredentials().then((azureSession) => {
      if (azureSession) {
        // Session is active; form fields remain blank intentionally (API key not stored).
        if (azureSession.proxyUrl) setAzureProxyUrl(azureSession.proxyUrl)
        setAzureSessionActive(true)
        setAzureSessionExpiresAt(getSessionExpiresAt())
      }
    })
  }, [])

  const handleSaveApiKey = () => {
    if (apiKey && apiKey.trim()) {
      saveApiKey(apiKey.trim())
      setTestResult(null)
    }
  }

  const handleClearApiKey = () => {
    clearApiKey()
    setApiKey('')
    setTestResult(null)
  }

  const handleTestOpenAIConnection = async () => {
    setTestingConnection(true)
    setTestResult(null)
    
    try {
      const result = await testAIConnection({ apiKey }, 'openai')
      setTestResult({
        success: true,
        message: `Successfully connected to OpenAI API. Available models: ${result.models.slice(0, 3).join(', ')}...`
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection failed: ${error.message}`
      })
    } finally {
      setTestingConnection(false)
    }
  }
  
  const handleTestAzureOpenAIConnection = async () => {
    setTestingConnection(true)
    setTestResult(null)
    
    try {
      // POST credentials to proxy → proxy stores API key in memory, returns session ID.
      // The session ID (not the API key) is then saved to DHIS2 userDataStore.
      await saveAzureCredentials({
        endpoint: azureEndpoint,
        deploymentName: azureDeploymentName,
        apiVersion: azureApiVersion,
        apiKey: azureApiKey,
        proxyUrl: azureProxyUrl || undefined,
      })

      // Test uses the in-memory cache just populated by saveAzureCredentials
      const result = await testAIConnection({}, 'azure-openai')

      setAzureSessionActive(true)
      setAzureSessionExpiresAt(getSessionExpiresAt())
      setTestResult({
        success: true,
        message: result.message || 'Azure credentials saved to DHIS2 and connection verified.'
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection failed: ${error.message}`
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleClearAzureSession = async () => {
    setTestingConnection(true)
    setTestResult(null)

    try {
      await clearAzureCredentials()
      setAzureSessionActive(false)
      setAzureSessionExpiresAt(null)
      setAzureEndpoint('')
      setAzureDeploymentName('')
      setAzureApiVersion('2024-02-15-preview')
      setAzureApiKey('')
      setTestResult({
        success: true,
        message: 'Azure session cleared. The proxy session has been invalidated.'
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: `Unable to clear Azure credentials: ${error.message}`
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleTestOllamaConnection = async () => {
    setTestingConnection(true)
    setTestResult(null)
    
    try {
      const result = await testAIConnection({
        serverUrl: ollamaServerUrl
      }, 'ollama')
      setAvailableOllamaModels(result.models || [])
      setTestResult({
        success: true,
        message: `Successfully connected to Ollama. Available models: ${result.models.join(', ')}`
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection failed: ${error.message}`
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSaveSettings = () => {
    // Create settings object based on the selected provider
    const settings = {
      maxTokens,
      cachingEnabled,
      aiProvider
    }
    
    // Add provider-specific settings
    if (aiProvider === 'openai') {
      settings.model = model
      settings.temperature = temperature
    } else if (aiProvider === 'ollama') {
      settings.ollamaServerUrl = ollamaServerUrl
      settings.ollamaModel = ollamaModel
    } else if (aiProvider === 'azure-openai') {
      settings.temperature = temperature
    }
    
    // Save API key only for direct OpenAI provider
    if (aiProvider === 'openai' && apiKey && apiKey.trim()) {
      saveApiKey(apiKey.trim())
    }
    
    saveSettings(settings)
    onClose()
  }

  return (
    <div className="settings-container">
      <Card>
        <Box padding="16px">
          <h2>Settings</h2>
          <p>Configure your DHIS2 AI Insights application settings.</p>
          
          <h3>AI Provider</h3>
          <p>Choose which AI provider to use for analysis.</p>
          
          <div className="settings-field">
            <SingleSelectField
              label="AI Provider"
              selected={aiProvider}
              onChange={({ selected }) => setAIProvider(selected)}
              className="selector-field"
            >
              <SingleSelectOption value="openai" label="OpenAI API (GPT-4, etc.)" />
              <SingleSelectOption value="azure-openai" label="Azure OpenAI" />
              <SingleSelectOption value="ollama" label="Ollama (Local or Remote)" />
            </SingleSelectField>
          </div>
          
          {aiProvider === 'openai' ? (
            <>
              <h3>OpenAI API Key</h3>
              <p>
                This application uses OpenAI's API to analyze your DHIS2 data. 
                You need to provide your own API key.
              </p>
              
              <div className="settings-field">
                <InputField
                  label="OpenAI API Key"
                  type={apiKeyMasked ? 'password' : 'text'}
                  value={apiKey}
                  onChange={({ value }) => setApiKey(value)}
                  placeholder="sk-..."
                  helpText="Your OpenAI API key will be stored securely in your browser's local storage."
                />
                <Box margin="8px 0">
                  <Switch
                    label="Show API key"
                    checked={!apiKeyMasked}
                    onChange={() => setApiKeyMasked(!apiKeyMasked)}
                  />
                </Box>
                <Box margin="16px 0">
                  <ButtonStrip>
                    <Button primary onClick={handleSaveApiKey}>Save API Key</Button>
                    <Button destructive onClick={handleClearApiKey}>Clear API Key</Button>
                    <Button onClick={handleTestOpenAIConnection} disabled={!apiKey || testingConnection}>
                      {testingConnection ? 'Testing...' : 'Test Connection'}
                    </Button>
                  </ButtonStrip>
                </Box>
              </div>
            </>
          ) : aiProvider === 'azure-openai' ? (
            <>
              <h3>Azure OpenAI Configuration</h3>
              <p>
                Credentials are sent to the <strong>AI proxy server</strong> and held only in proxy memory.
                The browser never stores or transmits your API key directly to Azure.
              </p>

              <div className="settings-field">
                <InputField
                  label="Azure Endpoint"
                  type="text"
                  value={azureEndpoint}
                  onChange={({ value }) => setAzureEndpoint(value)}
                  placeholder="https://your-resource.openai.azure.com"
                  helpText="Your Azure OpenAI resource endpoint."
                />
              </div>

              <div className="settings-field">
                <InputField
                  label="Deployment Name"
                  type="text"
                  value={azureDeploymentName}
                  onChange={({ value }) => setAzureDeploymentName(value)}
                  placeholder="your-deployment"
                  helpText="The name of your Azure OpenAI model deployment."
                />
              </div>

              <div className="settings-field">
                <InputField
                  label="API Version"
                  type="text"
                  value={azureApiVersion}
                  onChange={({ value }) => setAzureApiVersion(value)}
                  placeholder="2024-02-15-preview"
                  helpText="Azure OpenAI API version."
                />
              </div>

              <div className="settings-field">
                <InputField
                  label="Azure API Key"
                  type={azureApiKeyMasked ? 'password' : 'text'}
                  value={azureApiKey}
                  onChange={({ value }) => setAzureApiKey(value)}
                  placeholder="azure-api-key"
                  helpText="Sent once to the proxy to create a session. Never stored in the browser or DHIS2 database."
                />
                <Box margin="8px 0">
                  <Switch
                    label="Show Azure API key"
                    checked={!azureApiKeyMasked}
                    onChange={() => setAzureApiKeyMasked(!azureApiKeyMasked)}
                  />
                </Box>
                <div className="settings-field">
                  <InputField
                    label="Proxy URL (optional)"
                    type="text"
                    value={azureProxyUrl}
                    onChange={({ value }) => setAzureProxyUrl(value)}
                    placeholder="http://localhost:3000"
                    helpText="URL of the running AI proxy. Leave blank to use the auto-detected default."
                  />
                </div>
                <Box margin="16px 0">
                  <ButtonStrip>
                    <Button 
                      onClick={handleTestAzureOpenAIConnection} 
                      disabled={!azureEndpoint || !azureDeploymentName || !azureApiVersion || !azureApiKey || testingConnection}
                    >
                      {testingConnection ? 'Testing...' : 'Save & Test Azure Connection'}
                    </Button>
                    <Button onClick={handleClearAzureSession} disabled={testingConnection}>
                      Clear Azure Session
                    </Button>
                  </ButtonStrip>
                </Box>
              </div>

              <NoticeBox title="Secured via proxy — API key never leaves your server" success>
                All Azure OpenAI requests are forwarded by the AI proxy. The browser sends only a
                session token; your API key is held exclusively in proxy memory and is never written
                to any browser storage or database.
              </NoticeBox>

              {azureSessionActive && azureSessionExpiresAt && (
                <NoticeBox title="Session active — idle timeout in 30 minutes" warning>
                  Credentials are loaded and in use. The session will be automatically cleared after
                  <strong> 30 minutes of inactivity</strong> (no AI queries sent). Next expiry if idle
                  until <strong>{new Date(azureSessionExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>.
                  The timer resets each time you send a query.
                </NoticeBox>
              )}

              <NoticeBox title="Secure server-side session reference" info>
                Only the <strong>proxy session ID</strong> is saved in the <strong>DHIS2 User Data Store</strong>
                — no API keys, no credentials. The session ID is useless without the running proxy.
                In dev mode a tab-scoped sessionStorage fallback is used instead.
              </NoticeBox>
            </>
          ) : (
            <>
              <h3>Ollama Server Configuration</h3>
              <p>
                Configure your Ollama server settings. You can use a local server (default: http://localhost:11434)
                or connect to a remote Ollama server.
              </p>
              <NoticeBox title="Ollama Connection Guide" info>
                <p>
                  <strong>Running in DHIS2 hosted environment?</strong> Due to browser security restrictions,
                  you'll need to run a local proxy server to connect to Ollama.
                </p>
                <ol style={{ paddingLeft: '20px', marginTop: '5px' }}>
                  <li>Navigate to the <code>ollama-proxy</code> folder in your app files</li>
                  <li>Run <code>npm install</code> to install dependencies</li>
                  <li>Start the proxy with <code>npm start</code></li>
                  <li>Use <code>http://localhost:3000</code> as the Ollama Server URL in settings</li>
                  <li>For larger models that might time out, you can set a custom timeout:
                    <code>TIMEOUT=120000 node proxy.js</code> (for 120 seconds)</li>
                </ol>
                <p>
                  <strong>Using a locally installed version of this app?</strong> You can connect directly
                  to your Ollama server at <code>http://localhost:11434</code> without using the proxy.
                </p>
                <p>
                  <strong>Troubleshooting timeouts:</strong> If you experience timeouts, try a smaller model
                  like <code>llama3:8b</code> or <code>mistral</code> instead of larger models, and increase
                  the proxy timeout as noted above.
                </p>
              </NoticeBox>
              
              <div className="settings-field">
                <InputField
                  label="Ollama Server URL"
                  type="text"
                  value={ollamaServerUrl}
                  onChange={({ value }) => setOllamaServerUrl(value)}
                  placeholder="http://localhost:11434"
                  helpText="URL of your Ollama server. The default is http://localhost:11434 for a local Ollama installation."
                />
                
                <Box margin="16px 0">
                  <Button 
                    onClick={handleTestOllamaConnection} 
                    disabled={!ollamaServerUrl || testingConnection}
                    primary
                  >
                    {testingConnection ? 'Testing...' : 'Connect to Ollama Server'}
                  </Button>
                </Box>
                
                {availableOllamaModels.length > 0 && (
                  <Box margin="16px 0">
                    <SingleSelectField
                      label="Ollama Model"
                      selected={ollamaModel}
                      onChange={({ selected }) => setOllamaModel(selected)}
                      className="selector-field"
                      helpText="Select the model to use from your Ollama server."
                    >
                      {availableOllamaModels.map(model => (
                        <SingleSelectOption key={model} value={model} label={model} />
                      ))}
                    </SingleSelectField>
                  </Box>
                )}
              </div>
            </>
          )}
          
          {testingConnection && (
            <Box margin="16px 0">
              <CircularLoader small />
              <span style={{ marginLeft: '8px' }}>Testing connection to {aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'azure-openai' ? 'Azure OpenAI' : 'Ollama'}...</span>
            </Box>
          )}
          
          {testResult && (
            <Box margin="16px 0">
              <NoticeBox
                title={testResult.success ? 'Connection Successful' : 'Connection Failed'}
                error={!testResult.success}
                success={testResult.success}
              >
                {testResult.message}
              </NoticeBox>
            </Box>
          )}
          
          <Divider margin="16px 0" />
          
          <Box margin="16px 0">
            <Switch
              label="Show advanced settings"
              checked={showAdvanced}
              onChange={() => setShowAdvanced(!showAdvanced)}
            />
          </Box>
          
          {showAdvanced && (
            <>
              <h3>AI Model Settings</h3>
              
              {aiProvider === 'openai' || aiProvider === 'azure-openai' ? (
                <>
                  <div className="settings-field">
                    <InputField
                      label="Temperature"
                      type="number"
                      value={temperature}
                      onChange={({ value }) => setTemperature(Number(value))}
                      step={0.1}
                      min={0}
                      max={2}
                      helpText="Controls randomness. Lower values are more focused, higher values more creative."
                    />
                  </div>
                </>
              ) : null}
              
              <div className="settings-field">
                <InputField
                  label="Max Tokens"
                  type="number"
                  value={maxTokens}
                  onChange={({ value }) => setMaxTokens(Number(value))}
                  helpText="Maximum number of tokens to generate in responses."
                />
              </div>
              
              <Divider margin="16px 0" />
              
              <h3>Application Settings</h3>
              <div className="settings-field">
                <Switch
                  label="Enable response caching"
                  checked={cachingEnabled}
                  onChange={() => setCachingEnabled(!cachingEnabled)}
                  helpText="Cache AI responses to save API costs for identical queries."
                />
              </div>
            </>
          )}
          
          <Box margin="24px 0 8px">
            <ButtonStrip>
              <Button primary onClick={handleSaveSettings}>Save Settings</Button>
              <Button onClick={onClose}>Cancel</Button>
            </ButtonStrip>
          </Box>
        </Box>
      </Card>
    </div>
  )
}