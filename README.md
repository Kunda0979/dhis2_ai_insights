# AI Insights for DHIS2

AI Insights allows users to analyze DHIS2 health data using natural language queries. Healthcare professionals, data analysts, and decision-makers can ask questions in plain language to identify trends, compare performance across organization units, and generate actionable insights from their data.

## Overview

This application connects directly to your DHIS2 instance and uses AI to help you understand your health data better. The app works by connecting to external AI services (OpenAI or locally-hosted Ollama) to interpret questions and analyze aggregate, event, and tracker data. AI Insights is generic and works with any DHIS2 instance and metadata structure.

## Key Features

### 🤖 AI-Powered Conversational Analysis
- Ask questions about your data in natural language using a WhatsApp-style chat interface
- Have flowing conversations with AI about your data with follow-up questions
- Receive insights based on selected data elements, indicators, and program indicators
- Get contextual recommendations for health interventions and actions
- Stream responses in real-time for immediate feedback

### 📊 Interactive Data Visualization Dashboard
- View your data in customizable charts and graphs
- Toggle between different visualization types (bar, line, pie, horizontal bar charts)
- Compare data across different periods with sortable tabular views
- Multi-organization unit analysis with comparative visualizations
- Time-series analysis for trend identification

### 📝 Advanced Report Generation
- Export AI responses as downloadable HTML reports that can be printed or saved as PDF
- Create email-ready summaries for stakeholders and team members
- Document insights for presentations, meetings, and SITREPs
- Generate management reports with AI-powered recommendations

### 🌐 Flexible AI Providers
- **OpenAI Integration**: Use GPT-4 and other OpenAI models with your API key
- **Azure OpenAI Integration**: Connect to Azure OpenAI deployments for enterprise use
- **Local Ollama Support**: Deploy locally with Ollama for offline use and complete data privacy
- **Network Proxy**: Included proxy server for network-restricted environments
- Configure models, temperature, and token limits to suit your needs

### 🏥 Multi-Organization Unit Support
- Analyze individual facilities or entire hierarchies
- Compare performance across child organization units
- Special prompts for multi-org unit comparative analysis
- Automatic name resolution for organization units (no more UIDs in reports)

## Use Cases

### Health Program Monitoring
- "What's the vaccination coverage trend for the selected period?"
- "Analyze these maternal health indicators and suggest focus areas"
- "Summarize the key observations from this nutrition data"
- "Which organization units are performing best and worst?"
- "Show me all districts with high cases of the selected indicators"

### Comparative Analysis
- "Compare performance across all child organization units"
- "Identify which facilities need immediate attention"
- "Rank the organization units by performance"
- "What are the main differences between organization units?"
- "Highlight organization units that are outliers"

### Data Interpretation & Insights
- "Explain the patterns in this indicator data"
- "What insights can you provide about these health metrics?"
- "Identify trends, compare performance across organization units"
- "Analyze anomalies or outliers in this dataset"
- "What emergent trends should I be aware of?"

### Report Preparation & Communication
- "Create a summary of these findings for my stakeholders"
- "Generate a SITREP based on this data"
- "Create an email to share these findings with my team"
- "Provide a summary of this health data for decision makers"
- "Generate a comparative analysis across all locations"

## Getting Started

This project was bootstrapped with [DHIS2 Application Platform](https://github.com/dhis2/app-platform).

### Prerequisites
- A running DHIS2 instance (v2.35 or later)
- For OpenAI: An internet connection and OpenAI API key
- For local models: Ollama installed with your preferred models

## Installation Options

### From Built Package:
1. Download the `.zip` file from the build/bundle directory
2. Log in to your DHIS2 instance as an administrator
3. Go to App Management
4. Click "Upload App" and select the downloaded zip file

### Development Setup:
1. Clone the repository
2. Run `yarn install` to install dependencies
3. Configure your DHIS2 server in `.env.development`
4. Run `yarn start` for development mode

## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.<br />
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `yarn test`

Launches the test runner and runs all available tests found in `/src`.<br />

### `yarn build`

Builds the app for production to the `build` folder.<br />
A deployable `.zip` file can be found in `build/bundle`!

### `yarn deploy`

Deploys the built app in the `build` folder to a running DHIS2 instance.<br />
You must run `yarn build` before running `yarn deploy`.

## How to Use DHIS2 AI Insights

### Initial Setup

1. After installation, open the app from your DHIS2 dashboard
2. Navigate to the Settings panel by clicking the "Settings" button
3. Choose your AI provider:
   - **OpenAI**: Enter your API key and select model
   - **Azure OpenAI**: Enter your API key, resource name, deployment name, and API version
   - **Ollama**: Configure server URL and select installed model
4. Save your settings

### Data Selection

1. Go to the "Data Selection" tab
2. Follow the step-by-step process:
   - Select an organization unit (individual facility, user org unit, or hierarchy)
   - Choose a data type (aggregate, indicator, or program indicator)
   - Select specific data elements to analyze
3. Select a time period for analysis (e.g., last month, this quarter, etc.)
4. Click "Analyze Data with AI" to proceed to the insights

### Getting AI Insights

1. In the AI Insights tab, you'll see a WhatsApp-style chat interface
2. Type your question or select from suggested prompts (including special multi-org unit prompts)
3. Click "Send" to submit your query (or use Ctrl+Enter)
4. Watch responses stream in real-time as the AI analyzes your data
5. Download any response as an HTML report using the download button
6. Ask follow-up questions to have flowing conversations with the AI
7. Use the "Clear Chat" button to start fresh conversations
8. Resize the chat window by dragging the bottom edge up or down

### Using the Dashboard

1. Switch to the "Data Dashboard" tab to view visualizations
2. Choose from different chart types (bar, line, pie, horizontal bar)
3. Toggle between chart and table views
4. Sort table data by clicking column headers
5. View multi-organization unit breakdowns when child units are included
6. Visualizations automatically update based on your selected data
7. Time-series data is automatically sorted chronologically for trend analysis

### Using Ollama (Local Models)

If you're using Ollama for local AI processing:

1. Install Ollama on your computer (from [ollama.ai](https://ollama.ai))
2. Pull a model (e.g., `ollama pull llama3`)
3. Run Ollama locally (`ollama serve`)
4. If running on the same machine as DHIS2, use http://localhost:11434 as server URL
5. For network-restricted environments, use the included proxy:
   ```
   cd ollama-proxy
   npm install
   npm start
   ```
   Then configure the app to use http://localhost:3000 as server URL

### Best Practices for AI Queries

- Be specific about what data aspects you want insights on
- Keep questions focused on the selected data elements
- Ask for specific recommendations when needed
- Try different questions to explore your data from multiple angles
- Use multi-org unit specific prompts when comparing facilities
- Ask follow-up questions to dive deeper into interesting findings

### Example Queries

#### General Analysis
- "What are the main trends in this data?"
- "Analyze trends in the selected data over time"
- "Identify anomalies or outliers in this dataset"
- "What insights can you provide about this data?"

#### Comparative Analysis (Multi-Org Units)
- "Which organization units are performing best and worst?"
- "Compare performance across all child organization units"
- "Identify which facilities need immediate attention"
- "Rank the organization units by performance"

#### Report Generation
- "Create a SITREP based on this data"
- "Generate an email to share these findings with my team"
- "Provide a summary of this health data for decision makers"
- "Create a comparative analysis across all locations"

### Chat Interface Features

- **Resizable Window**: Drag the bottom edge to resize the chat area
- **Keyboard Shortcuts**: Use Ctrl+Enter to send messages quickly
- **Real-time Streaming**: Watch responses appear in real-time
- **Conversation History**: Previous messages are maintained during your session
- **Download Reports**: Click the download button on any AI response to get an HTML report

## Learn More

- [DHIS2 Application Platform Documentation](https://platform.dhis2.nu/)
- [DHIS2 Application Runtime Documentation](https://runtime.dhis2.nu/)
- [React documentation](https://reactjs.org/)

## Credits

Developed by John Mark Esplana