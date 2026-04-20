const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001;
const TIMEOUT = parseInt(process.env.TIMEOUT || '120000', 10); // 120 seconds default timeout, configurable via env

// Enable CORS for all routes
app.use(cors({
  origin: '*', // Allow all origins for testing, restrict in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept'],
  credentials: true
}));

// Add explicit CORS headers for all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Ollama proxy is running' });
});

// Proxy to Ollama API
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:11434',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/api' // Keep the /api path
  },
  // Use configurable timeout
  proxyTimeout: TIMEOUT,     // Proxy timeout from env variable
  timeout: TIMEOUT,          // Socket timeout from env variable
  onProxyReq: (proxyReq, req, res) => {
    // Log request for debugging
    console.log(`[PROXY] ${req.method} ${req.path} -> Ollama API`);

    // Add origin to avoid CORS issues
    proxyReq.setHeader('Origin', 'http://localhost:11434');
  },
  onProxyRes: (proxyRes, req, res) => {
    // Add CORS headers to response
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Authorization';
    proxyRes.headers['Access-Control-Allow-Credentials'] = 'true';

    // Log response for debugging
    console.log(`[PROXY] Response from Ollama API: ${proxyRes.statusCode}`);
  },
  // Handle proxy errors
  onError: (err, req, res) => {
    console.error(`[PROXY] Error: ${err.message}`);
    res.status(500).json({
      status: 'error',
      message: `Proxy error: ${err.message}`,
      error: err.toString()
    });
  }
}));

// Add a catch-all route for debugging
app.use('*', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Ollama proxy server is running',
    help: 'This is the root endpoint. To use the proxy, configure your app to use http://localhost:' + PORT,
    config: {
      port: PORT,
      timeout: TIMEOUT + 'ms',
      ollamaServer: 'http://localhost:11434'
    },
    endpoints: {
      '/health': 'Health check endpoint',
      '/api/...': 'Proxy to Ollama API (e.g., /api/tags, /api/chat)'
    },
    usage: {
      setCustomTimeout: 'Run with TIMEOUT=90000 node proxy.js for a 90 second timeout',
      setCustomPort: 'Run with PORT=8080 node proxy.js to use port 8080'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Ollama Proxy Server running on port ${PORT}`);
  console.log(`Using timeout of ${TIMEOUT}ms for Ollama API requests`);
  console.log(`Use this URL in your DHIS2 AI Insights app: http://localhost:${PORT}`);
  console.log(`Test the proxy with: curl http://localhost:${PORT}/health`);
  console.log(`Check available Ollama models with: curl http://localhost:${PORT}/api/tags`);
  console.log(`\nTo set a custom timeout: TIMEOUT=90000 node proxy.js (for 90 seconds)`);
});