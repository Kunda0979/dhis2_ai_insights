import React, { useState, useEffect, useRef } from 'react'
import { 
  Card, 
  TextAreaField, 
  Button, 
  CircularLoader,
  NoticeBox,
  Box,
  Chip,
  ButtonStrip,
  Divider,
  Tooltip
} from '@dhis2/ui'
import { IconArrowRight24, IconDownload24, IconInfo24, IconVisualizationColumn24 } from '@dhis2/ui-icons'
import ReactMarkdown from 'react-markdown'
import { fetchDataForElements } from '../utils/dhis2Data'
import { sendToAI } from '../utils/aiService'
import { generateWordReport } from '../utils/reportGenerator'
import { getAIInfo } from '../utils/aiService'

// Suggested prompts for users
const suggestedPrompts = [
  "Analyze trends in the selected data over time",
  "Identify anomalies or outliers in this dataset",
  "Compare the current period with previous periods",
  "What insights can you provide about this data?",
  "Suggest actions based on this data",
  "Show me the key performance indicators",
  "Provide a summary of this health data for decision makers",
  "What emergent trends should I be aware of?",
  "How does this data compare to regional benchmarks?",
  "Create an email to share these findings with my team",
  "Generate a SITREP based on this data",
]

// Multi-org unit specific prompts (shown when child org units are included)
const multiOrgUnitPrompts = [
  "Which organization units are performing best and worst?",
  "Show me all districts with high cases of the selected indicators",
  "Compare performance across all child organization units",
  "Identify which facilities need immediate attention",
  "Rank the organization units by performance",
  "Which areas show concerning trends that require intervention?",
  "What are the main differences between organization units?",
  "Highlight organization units that are outliers",
  "Create a comparative analysis across all locations",
  "Which organization units should be prioritized for support?",
]

export const AIQuerySelection = ({
  engine,
  selectedDataElements,
  selectedPeriod,
  selectedOrgUnit,
  selectedDataType,
  user,
  conversation: externalConversation,
  setConversation: setExternalConversation,
  dataSnapshot: externalDataSnapshot,
  setDataSnapshot: setExternalDataSnapshot
}) => {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [error, setError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [chatHeight, setChatHeight] = useState(400) // Default height
  const [aiInfo, setAIInfo] = useState(null) // AI provider info
  const [streamingMessage, setStreamingMessage] = useState('') // For streaming text
  const [isStreaming, setIsStreaming] = useState(false) // Track streaming state
  const resizableChatRef = useRef(null)

  // Use external state if provided, fallback to local state for backward compatibility
  const conversation = externalConversation || []
  const setConversation = setExternalConversation || (() => {})
  const dataSnapshot = externalDataSnapshot || null
  const setDataSnapshot = setExternalDataSnapshot || (() => {})

  useEffect(() => {
    // Reset response when data selection changes
    setResponse(null)
    // Note: dataSnapshot is now managed by parent component
  }, [selectedDataElements, selectedPeriod, selectedOrgUnit])

  // Fetch AI provider info
  useEffect(() => {
    const info = getAIInfo()
    setAIInfo(info)
  }, [])

  // Auto-scroll to bottom when conversation updates or streaming
  useEffect(() => {
    if (conversation.length > 0 || isStreaming) {
      const chatContainer = document.getElementById('chat-messages')
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight
      }
    }
  }, [conversation, isLoading, error, streamingMessage, isStreaming])

  // Handle resize start - mouse
  const handleMouseDown = (e) => {
    e.preventDefault()
    setIsDragging(true)
    setStartY(e.clientY)
  }

  // Handle resize start - touch
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true)
      setStartY(e.touches[0].clientY)
    }
  }

  // Handle resize drag
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return
      
      const delta = e.clientY - startY
      if (resizableChatRef.current) {
        const newHeight = chatHeight + delta
        // Apply min/max constraints
        const constrainedHeight = Math.max(200, Math.min(newHeight, window.innerHeight * 0.8))
        resizableChatRef.current.style.height = `${constrainedHeight}px`
        setChatHeight(constrainedHeight)
        setStartY(e.clientY)
      }
    }

    const handleTouchMove = (e) => {
      if (!isDragging || e.touches.length !== 1) return
      
      const delta = e.touches[0].clientY - startY
      if (resizableChatRef.current) {
        const newHeight = chatHeight + delta
        // Apply min/max constraints
        const constrainedHeight = Math.max(200, Math.min(newHeight, window.innerHeight * 0.8))
        resizableChatRef.current.style.height = `${constrainedHeight}px`
        setChatHeight(constrainedHeight)
        setStartY(e.touches[0].clientY)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    const handleTouchEnd = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchcancel', handleTouchEnd)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [isDragging, startY, chatHeight])

  const handleQueryChange = ({ value }) => {
    setQuery(value)
  }

  const handleQuerySubmit = async () => {
    if (!query.trim()) return
    
    // Clear previous errors
    setError(null)
    
    // Convert selectedDataElements to array if it's not already
    const dataElementsArray = Array.isArray(selectedDataElements) ? selectedDataElements : [];
    
    if (!dataElementsArray || dataElementsArray.length === 0) {
      setError('Please select at least one data element')
      return
    }
    
    if (!selectedOrgUnit) {
      setError('Please select an organization unit')
      return
    }
    
    try {
      setIsLoading(true)
      setError(null)
      
      // Ensure we have the data elements as an array 
      // The selectedDataElements could be an array of IDs from the Transfer component
      const dataElementsArray = Array.isArray(selectedDataElements) ? selectedDataElements : [];
      
      console.log("Using data elements:", dataElementsArray);
      console.log("Selected Period:", selectedPeriod, "Type:", typeof selectedPeriod);
      console.log("Selected OrgUnit:", selectedOrgUnit, "Type:", typeof selectedOrgUnit);
      
      if (dataElementsArray.length === 0) {
        setError('Please select at least one data element');
        setIsLoading(false);
        return;
      }
      
      if (!selectedOrgUnit) {
        setError('Please select an organization unit');
        setIsLoading(false);
        return;
      }
      
      // Fetch data from DHIS2 if not already fetched
      let data = dataSnapshot
      if (!data) {
        try {
          // Use the data type passed from the parent component
          const dataType = selectedDataType || 'aggregate';
          
          // Log to diagnose the issue
          console.log("Fetching data with elements:", JSON.stringify(dataElementsArray));
          console.log("Using data type:", dataType);
          
          data = await fetchDataForElements(
            engine,
            dataElementsArray,
            selectedPeriod,
            selectedOrgUnit,
            dataType
          )
        } catch (err) {
          console.error("Error fetching data:", err);
          setError(`Error fetching data: ${err.message}`);
          setIsLoading(false);
          return;
        }
        setDataSnapshot(data)
      }
      
      // Add metadata about the query
      const context = {
        user: {
          name: user.name,
          username: user.username,
          orgUnits: user.organisationUnits.map(ou => ou.name).join(', ')
        },
        dataElements: dataElementsArray, // Just pass the data element IDs
        period: selectedPeriod,
        orgUnit: {
          id: selectedOrgUnit.id,
          name: selectedOrgUnit.displayName || selectedOrgUnit.name || selectedOrgUnit.id,
          displayName: selectedOrgUnit.displayName || selectedOrgUnit.name || selectedOrgUnit.id,
          includeChildOrgUnits: selectedOrgUnit.includeChildOrgUnits,
          path: selectedOrgUnit.path,
          level: selectedOrgUnit.level,
          isSpecial: selectedOrgUnit.isSpecial
        },
        multiOrgUnitMode: data && data.multiOrgUnitMode,
        childOrgUnits: data && data.childOrgUnits ? data.childOrgUnits.map(ou => ({
          id: ou.id,
          name: ou.displayName || ou.name,
          displayName: ou.displayName || ou.name,
          path: ou.path,
          level: ou.level,
          parent: ou.parent,
          organisationUnitGroups: ou.organisationUnitGroups || []
        })) : []
      }
      
      // Send to AI with streaming support
      const newMessage = {
        role: 'user',
        content: query,
        timestamp: new Date().toISOString()
      }
      
      // Start streaming
      setIsStreaming(true)
      setStreamingMessage('')
      
      // Add user message to conversation immediately
      setConversation([...conversation, newMessage])
      
      const result = await sendToAI(query, data, context, conversation, (chunk) => {
        // Update streaming message as chunks arrive
        setStreamingMessage(prev => prev + chunk)
      })
      
      // Streaming complete - add final AI message to conversation
      setIsStreaming(false)
      setStreamingMessage('')
      
      const aiMessage = {
        role: 'assistant',
        content: result.message,
        timestamp: new Date().toISOString()
      }
      
      setConversation([...conversation, newMessage, aiMessage])
      setResponse(result)
      setQuery('')
    } catch (err) {
      setError(`Error: ${err.message}`)
      setIsStreaming(false)
      setStreamingMessage('')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleQuerySubmit()
    }
  }

  const handleClearConversation = () => {
    setConversation([])
    setResponse(null)
  }

  const handleSuggestedPromptClick = (prompt) => {
    setQuery(prompt)
  }
  
  const handleDownloadReport = async (message) => {
    try {
      // Create context object for the report
      const context = {
        user: user,
        dataElements: selectedDataElements,
        period: selectedPeriod,
        orgUnit: selectedOrgUnit
      }
      
      // Show loading indicator
      setIsLoading(true)
      
      // Generate and download Word document
      await generateWordReport(message, context)
      
      // Hide loading indicator
      setIsLoading(false)
    } catch (error) {
      console.error("Error generating report:", error)
      setError(`Error generating report: ${error.message}`)
      setIsLoading(false)
    }
  }

  // Helper function to format selected data elements for display
  const formatDataElementsDisplay = (elements) => {
    if (!elements || elements.length === 0) return 'None selected'
    
    if (elements.length <= 3) {
      return elements.map(el => el.displayName || el.id || el).join(', ')
    } else {
      const first = elements.slice(0, 2).map(el => el.displayName || el.id || el).join(', ')
      return `${first} and ${elements.length - 2} more`
    }
  }

  // Helper function to format period display
  const formatPeriodDisplay = (period) => {
    const periodMap = {
      'THIS_MONTH': 'This Month',
      'LAST_MONTH': 'Last Month', 
      'THIS_QUARTER': 'This Quarter',
      'LAST_QUARTER': 'Last Quarter',
      'THIS_YEAR': 'This Year',
      'LAST_YEAR': 'Last Year',
      'LAST_12_MONTHS': 'Last 12 Months'
    }
    return periodMap[period] || period
  }

  return (
    <div className="insights-container">
      {/* Current Selection Summary */}
      <Card style={{ marginBottom: '16px' }}>
        <Box padding="12px 16px">
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '14px' }}>
            <div>
              <strong>Data:</strong> <span style={{ color: '#666' }}>{formatDataElementsDisplay(selectedDataElements)}</span>
            </div>
            <div>
              <strong>Period:</strong> <span style={{ color: '#666' }}>{formatPeriodDisplay(selectedPeriod)}</span>
            </div>
            <div>
              <strong>Org Unit:</strong> <span style={{ color: '#666' }}>
                {selectedOrgUnit ? selectedOrgUnit.displayName || selectedOrgUnit.name || selectedOrgUnit.id : 'None selected'}
                {selectedOrgUnit && selectedOrgUnit.includeChildOrgUnits && <span style={{ color: '#1976d2' }}> (+ child units)</span>}
              </span>
            </div>
          </div>
        </Box>
      </Card>
      
      <div className="chat-container" style={{ flex: 1, minHeight: '600px' }}>
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>AI Assistant</span>
            {conversation.length > 0 && (
              <span style={{
                fontSize: '11px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '8px',
                fontWeight: 'normal'
              }}>
                {conversation.length} messages
              </span>
            )}
            {aiInfo && (
              <span style={{
                fontSize: '12px',
                backgroundColor:
                  aiInfo.provider === 'openai'
                    ? '#10a37f'
                    : aiInfo.provider === 'azure-openai'
                      ? '#0078d4'
                      : aiInfo.provider === 'ollama'
                        ? '#ff6700'
                        : '#6b7280',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '10px',
                fontWeight: 'bold'
              }}>
                {aiInfo.provider === 'openai'
                  ? `OpenAI: ${aiInfo.model}`
                  : aiInfo.provider === 'azure-openai'
                    ? `Azure OpenAI: ${aiInfo.model}`
                    : aiInfo.provider === 'ollama'
                      ? `Ollama: ${aiInfo.model}`
                      : `AI: ${aiInfo.model || 'not-configured'}`}
              </span>
            )}
          </div>
          {conversation.length > 0 && (
            <Button small onClick={handleClearConversation}>
              Clear Chat
            </Button>
          )}
        </div>
        
        <div 
          className="resizable-chat-area" 
          ref={resizableChatRef}
          style={{ height: `${chatHeight}px` }}
        >
          <div className="chat-messages" id="chat-messages">
            {/* Welcome message when there's no conversation */}
            {conversation.length === 0 && !isLoading && (
              <div className="message-bubble message-ai">
                <p>Hello! I'm your AI assistant. Ask me anything about your selected data.</p>
                <div className="message-timestamp">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
            )}
            
            {/* Display conversation messages */}
            {conversation.map((message, index) => (
              <div 
                key={index} 
                className={`message-bubble ${message.role === 'user' ? 'message-user' : 'message-ai'}`}
              >
                {message.role === 'user' ? (
                  <p>{message.content}</p>
                ) : (
                  <div className="ai-message-container">
                    <div className="ai-message">
                      <ReactMarkdown 
                        components={{
                          // Remove className prop to fix ReactMarkdown crash and reduce spacing
                          p: ({node, ...props}) => <p style={{ marginBottom: '8px', marginTop: '0' }} {...props} />,
                          div: ({node, ...props}) => <div {...props} />,
                          span: ({node, ...props}) => <span {...props} />,
                          br: () => <br />,
                          // Handle headings with reduced spacing
                          h1: ({node, ...props}) => <h1 style={{ marginBottom: '8px', marginTop: '16px' }} {...props} />,
                          h2: ({node, ...props}) => <h2 style={{ marginBottom: '6px', marginTop: '12px' }} {...props} />,
                          h3: ({node, ...props}) => <h3 style={{ marginBottom: '4px', marginTop: '8px' }} {...props} />,
                          h4: ({node, ...props}) => <h4 style={{ marginBottom: '4px', marginTop: '8px' }} {...props} />,
                          // Handle lists with reduced spacing
                          ul: ({node, ...props}) => <ul style={{ marginBottom: '8px', marginTop: '0', paddingLeft: '16px' }} {...props} />,
                          ol: ({node, ...props}) => <ol style={{ marginBottom: '8px', marginTop: '0', paddingLeft: '16px' }} {...props} />,
                          li: ({node, ...props}) => <li style={{ marginBottom: '2px' }} {...props} />
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    
                    {/* Actions for AI messages */}
                    <div className="message-actions">
                      <Tooltip content="Download as HTML report (can be printed or saved as PDF)">
                        <Button
                          small
                          icon={<IconDownload24 />}
                          onClick={() => handleDownloadReport(message)}
                        >
                          Download HTML Report
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                )}
                
                {message.role === 'assistant' && message.recommendations && (
                  <Box margin="16px 0 0 0" className="recommendations-container">
                    <h4>Recommendations</h4>
                    {message.recommendations.map((rec, i) => (
                      <div key={i} className="recommendation-item">
                        {rec}
                      </div>
                    ))}
                  </Box>
                )}
                
                <div className="message-timestamp">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            
            {/* Streaming message */}
            {isStreaming && streamingMessage && (
              <div className="message-bubble message-ai">
                <div className="ai-message-container">
                  <div className="ai-message">
                    <ReactMarkdown 
                      components={{
                        // Remove className prop and reduce spacing for streaming messages
                        p: ({node, ...props}) => <p style={{ marginBottom: '8px', marginTop: '0' }} {...props} />,
                        div: ({node, ...props}) => <div {...props} />,
                        span: ({node, ...props}) => <span {...props} />,
                        br: () => <br />,
                        // Handle headings with reduced spacing
                        h1: ({node, ...props}) => <h1 style={{ marginBottom: '8px', marginTop: '16px' }} {...props} />,
                        h2: ({node, ...props}) => <h2 style={{ marginBottom: '6px', marginTop: '12px' }} {...props} />,
                        h3: ({node, ...props}) => <h3 style={{ marginBottom: '4px', marginTop: '8px' }} {...props} />,
                        h4: ({node, ...props}) => <h4 style={{ marginBottom: '4px', marginTop: '8px' }} {...props} />,
                        // Handle lists with reduced spacing
                        ul: ({node, ...props}) => <ul style={{ marginBottom: '8px', marginTop: '0', paddingLeft: '16px' }} {...props} />,
                        ol: ({node, ...props}) => <ol style={{ marginBottom: '8px', marginTop: '0', paddingLeft: '16px' }} {...props} />,
                        li: ({node, ...props}) => <li style={{ marginBottom: '2px' }} {...props} />
                      }}
                    >
                      {streamingMessage}
                    </ReactMarkdown>
                  </div>
                </div>
                <div className="message-timestamp">
                  Streaming... {new Date().toLocaleTimeString()}
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            {isLoading && !isStreaming && (
              <div className="message-bubble message-ai" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CircularLoader small />
                <p>Analyzing your data...</p>
              </div>
            )}
            
            {/* Initial streaming indicator */}
            {isStreaming && !streamingMessage && (
              <div className="message-bubble message-ai" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CircularLoader small />
                <p>Thinking...</p>
              </div>
            )}
            
            {/* Error message */}
            {error && (
              <div className="message-bubble message-ai" style={{ backgroundColor: '#ffeded', borderLeft: '3px solid #d32f2f' }}>
                <p><strong>Error:</strong> {error}</p>
                <div className="message-timestamp">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
          {/* Resize handle */}
          <div 
            className="resize-handle" 
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            title="Drag to resize chat area"
          ></div>
        </div>
        
        <div className="chat-input-area">
          <Card>
            <Box padding="16px">
              <div className="query-input">
                <TextAreaField
                  label="What would you like to know about this data?"
                  value={query}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message here..."
                  rows={2}
                />
                
                <div className="query-button-container">
                  <Button
                    primary
                    onClick={handleQuerySubmit}
                    disabled={isLoading || !query.trim()}
                    icon={<IconArrowRight24 />}
                  >
                    Send
                  </Button>
                </div>
              </div>
            </Box>
          </Card>
        </div>
      </div>
      
      {/* Suggested prompts as a separate scrollable section below the chat */}
      <div className="suggested-prompts-container">
        <Card>
          <Box padding="16px">
            <p style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <IconInfo24 /> Suggested Questions:
            </p>
            <div className="suggested-prompts-grid">
              {suggestedPrompts.slice(0, 6).map((prompt, index) => (
                <div
                  key={index}
                  className="suggested-prompt-compact"
                  onClick={() => handleSuggestedPromptClick(prompt)}
                >
                  {prompt}
                </div>
              ))}
            </div>
            
            {/* Multi-org unit specific prompts */}
            {selectedOrgUnit && selectedOrgUnit.includeChildOrgUnits && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ marginBottom: '8px', fontSize: '14px', color: '#1976d2', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <IconVisualizationColumn24 /> Multi-Organization Unit Questions:
                </p>
                <div className="suggested-prompts-grid">
                  {multiOrgUnitPrompts.slice(0, 6).map((prompt, index) => (
                    <div
                      key={`multi-${index}`}
                      className="suggested-prompt-compact multi-org"
                      onClick={() => handleSuggestedPromptClick(prompt)}
                    >
                      {prompt}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Box>
        </Card>
      </div>
    </div>
  )
}