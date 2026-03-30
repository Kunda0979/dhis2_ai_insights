import React, { useState, useEffect } from 'react'
import { useDataEngine, useDataQuery } from '@dhis2/app-runtime'
import { 
  CenteredContent, 
  CircularLoader, 
  NoticeBox, 
  Card,
  Button,
  Box,
  Tab,
  TabBar,
  Divider
} from '@dhis2/ui'
import { IconVisualizationColumn24 } from '@dhis2/ui-icons'

import './App.css'
import { AIQuerySelection } from './components/AIQuerySelection.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'
import { DataDashboard } from './components/DataDashboard.jsx'
import { DatasetSelector } from './components/DatasetSelector.jsx'
import { isApiKeySet, getSettings } from './utils/storage'

// Query to retrieve current user's info and check connection
const userQuery = {
  me: {
    resource: 'me',
  },
}

const MainApp = () => {
  const engine = useDataEngine()
  const { loading, error, data } = useDataQuery(userQuery)
  const [activeTab, setActiveTab] = useState('data_selection')
  const [showSettings, setShowSettings] = useState(false)
  const [selectedDataElements, setSelectedDataElements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('THIS_MONTH') // Set default period
  const [selectedOrgUnit, setSelectedOrgUnit] = useState(null)
  const [selectedDataType, setSelectedDataType] = useState('aggregate') // Default data type
  const [apiKeySet, setApiKeySet] = useState(false)
  // Persistent chat state
  const [conversation, setConversation] = useState([])
  const [dataSnapshot, setDataSnapshot] = useState(null)

  useEffect(() => {
    // Check if API configuration is set
    const settings = getSettings() || {}
    const isConfigured =
      (settings.aiProvider === 'openai' && isApiKeySet()) ||
      (settings.aiProvider === 'azure-openai' &&
        isApiKeySet() &&
        settings.azureResourceName &&
        settings.azureDeploymentName) ||
      (settings.aiProvider === 'ollama' && settings.ollamaServerUrl && settings.ollamaModel)

    setApiKeySet(isConfigured)
  }, [showSettings])

  // Reset conversation when data selection changes
  useEffect(() => {
    setConversation([])
    setDataSnapshot(null)
  }, [selectedDataElements, selectedPeriod, selectedOrgUnit])

  if (loading) {
    return (
      <CenteredContent>
        <CircularLoader />
        <p>Loading DHIS2 AI Insights...</p>
      </CenteredContent>
    )
  }

  if (error) {
    return (
      <CenteredContent>
        <NoticeBox error title="Error loading application">
          {error.message || 'Unknown error'}
        </NoticeBox>
      </CenteredContent>
    )
  }

  if (!apiKeySet && !showSettings) {
    return (
      <CenteredContent>
        <Card>
          <div className="welcome-card">
            <p>
              This application uses artificial intelligence to help you analyze your DHIS2 data.
              To get started, you need to configure your AI provider settings.
            </p>
            <p>
              You can either connect to OpenAI's API with your API key or use a local Ollama instance
              for processing data without sending it to external services.
            </p>
            <Button primary onClick={() => setShowSettings(true)}>
              Configure Settings
            </Button>
          </div>
        </Card>
      </CenteredContent>
    )
  }

  return (
    <div className="container">
      <header className="header">
        <Button 
          small
          onClick={() => setShowSettings(!showSettings)}
        >
          Settings
        </Button>
      </header>
      
      <Divider margin="0 0 8px 0" />
      
      {showSettings ? (
        <SettingsPanel 
          onClose={() => setShowSettings(false)} 
          engine={engine}
        />
      ) : (
        <>
          <TabBar>
            <Tab 
              selected={activeTab === 'data_selection'} 
              onClick={() => setActiveTab('data_selection')}
            >
              Data Selection
            </Tab>
            <Tab 
              selected={activeTab === 'insights'} 
              onClick={() => setActiveTab('insights')}
              disabled={!selectedDataElements.length || !selectedOrgUnit}
            >
              AI Insights {conversation.length > 0 && <span style={{
                backgroundColor: '#1976d2',
                color: 'white',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '11px',
                marginLeft: '4px'
              }}>{conversation.length}</span>}
            </Tab>
            <Tab 
              selected={activeTab === 'dashboard'} 
              onClick={() => setActiveTab('dashboard')}
              disabled={!selectedDataElements.length || !selectedOrgUnit}
            >
              Data Dashboard
            </Tab>
          </TabBar>
          
          <Box padding="8px 16px">
            {activeTab === 'data_selection' ? (
              <>
                <DatasetSelector
                  engine={engine}
                  onDataElementsSelected={(elements, dataType, metadata) => {
                    // Store both the element IDs and their metadata if available
                    if (metadata && metadata.length > 0) {
                      console.log("Received detailed metadata:", metadata);
                      // Store elements with enriched metadata to be passed to child components
                      const enrichedElements = elements.map(id => {
                        const metaItem = metadata.find(m => m.id === id);
                        return metaItem || { id: id };
                      });
                      setSelectedDataElements(enrichedElements);
                    } else {
                      // Fallback to simple IDs if no metadata
                      setSelectedDataElements(elements);
                    }

                    if (dataType) {
                      setSelectedDataType(dataType);
                    }
                  }}
                  onPeriodSelected={setSelectedPeriod}
                  onOrgUnitSelected={setSelectedOrgUnit}
                />
                
                {selectedDataElements.length > 0 && selectedOrgUnit && (
                  <Box 
                    margin="32px 0 32px" 
                    display="flex" 
                    justifyContent="center"
                    background="#f5f9ff"
                    padding="24px"
                    borderRadius="8px"
                  >
                    <Button 
                      primary 
                      onClick={() => setActiveTab('insights')}
                      icon={<IconVisualizationColumn24 />}
                      large
                    >
                      Analyze Data with AI
                    </Button>
                  </Box>
                )}
              </>
            ) : activeTab === 'insights' ? (
              <AIQuerySelection 
                engine={engine}
                selectedDataElements={selectedDataElements}
                selectedPeriod={selectedPeriod}
                selectedOrgUnit={selectedOrgUnit}
                selectedDataType={selectedDataType}
                user={data.me}
                conversation={conversation}
                setConversation={setConversation}
                dataSnapshot={dataSnapshot}
                setDataSnapshot={setDataSnapshot}
              />
            ) : (
              <DataDashboard 
                engine={engine}
                selectedDataElements={selectedDataElements}
                selectedPeriod={selectedPeriod}
                selectedOrgUnit={selectedOrgUnit}
                selectedDataType={selectedDataType}
              />
            )}
          </Box>
        </>
      )}
    </div>
  )
}

const DevSettingsPreview = () => {
  return (
    <div className="app-container">
      <NoticeBox title="Developer Preview Mode" info>
        Running in localhost settings preview. DHIS2 authentication is bypassed so you can verify provider options.
      </NoticeBox>
      <SettingsPanel onClose={() => {}} engine={null} />
    </div>
  )
}

const App = () => {
  const isDevSettingsPreview =
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost' &&
    new URLSearchParams(window.location.search).get('preview') === 'settings'

  if (isDevSettingsPreview) {
    return <DevSettingsPreview />
  }

  return <MainApp />
}

export default App