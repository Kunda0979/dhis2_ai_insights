# Local AI Proxy (Ollama + Azure OpenAI)

This is a local proxy server for DHIS2 AI Insights that:

- Proxies Ollama requests when running in a DHIS2 hosted environment
- Exposes a secure Azure OpenAI wrapper endpoint so browser clients never call Azure directly

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
   - Use `http://localhost:3000` as the Ollama server URL
   - Click "Connect" to test the connection and show available models
   - Select your preferred model
   - Save settings

4. For Azure OpenAI usage, no static credentials are required in proxy environment variables.
   Enter Azure credentials in the app Settings UI, then click "Create Session and Test Connection".
   The proxy creates a short-lived in-memory Azure session and returns an `azureSessionId`.

Azure endpoint used by the frontend:

- POST /azure-openai/session
- DELETE /azure-openai/session
- POST /azure-openai/analyze
- GET /azure-openai/test

## Configuration

By default, the proxy runs on port 3000 and forwards Ollama requests to `http://localhost:11434`.

Optional Azure safety controls:

```bash
AZURE_PROXY_MAX_TOKENS=2000
AZURE_PROXY_MAX_REQUEST_BYTES=120000
AZURE_PROXY_RATE_LIMIT_WINDOW_MS=60000
AZURE_PROXY_RATE_LIMIT_MAX_REQUESTS=10
AZURE_PROXY_SESSION_TTL_MS=1800000
```

## Azure Session Security Model

- Users enter Azure endpoint, deployment, API version, and API key in the frontend.
- Frontend sends credentials once to `POST /azure-openai/session`.
- Proxy stores credentials in memory only, scoped to the returned `azureSessionId`.
- Frontend discards API key from UI state after session creation.
- Analysis requests use only `X-Azure-Session-Id`; browser never calls Azure directly.
- Sessions expire automatically after TTL and can be cleared manually via `DELETE /azure-openai/session`.

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