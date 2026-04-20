# Ollama API Proxy

This is a simple proxy server that allows DHIS2 AI Insights to communicate with a local Ollama instance when running in a DHIS2 hosted environment.

## Why is this needed?

When running the DHIS2 AI Insights app in a DHIS2 hosted environment (like play.dhis2.org), browser security policies prevent direct connections to localhost services like Ollama. This proxy provides a way to bypass these restrictions.

## Installation

```bash
# Install dependencies
npm install
```

## Usage

1. Make sure your Ollama server is running locally on the default port (11434)

2. Start the proxy server:
```bash
npm start
```

3. In your DHIS2 AI Insights app settings:
   - Select Ollama as the AI provider
   - Use `http://localhost:3001` as the Ollama server URL
   - Click "Connect" to test the connection and show available models
   - Select your preferred model
   - Save settings

## Configuration

By default, the proxy runs on port 3001 and forwards requests to `http://localhost:11434`.

You can change the port by setting the PORT environment variable:
```bash
PORT=8080 npm start
```

## Security Considerations

This proxy enables CORS for all origins, which is suitable for local development but not recommended for production. In a production environment, you should:

1. Restrict CORS to only allow specific origins
2. Set up proper authentication
3. Use HTTPS
4. Consider deploying the proxy on a server accessible to all users