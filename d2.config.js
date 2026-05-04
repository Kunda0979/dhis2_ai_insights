const config = {
    type: 'app',
    title: 'AI Insights',
    name: 'AI Insights',
    description: 'AI Insights allows users to analyze DHIS2 health data using natural language queries. Healthcare professionals, data analysts, and decision-makers can ask questions in plain language to identify trends, compare performance across organization units, and generate actionable insights from their data. The app works by connecting to external AI services (OpenAI or locally-hosted Ollama) to interpret questions and analyze aggregate, event, and tracker data. AI Insights is generic and works with any DHIS2 instance and metadata structure. The app requires an internet connection to communicate with AI services and may need API keys for OpenAI or local Ollama setup. All analysis happens through conversational interfaces that produce visualizations and downloadable reports.',
    author: 'John Mark Esplana',
    developer: {
        name: 'John Mark Esplana',
        url: 'https://github.com/jmesplana/dhis2_ai_insights'
    },
    entryPoints: {
        app: './src/App.jsx',
    },
    authorities: []
}

module.exports = config
