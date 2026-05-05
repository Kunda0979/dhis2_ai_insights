const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const crypto = require('crypto');
const coreHttp = require('http');
const coreHttps = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const TIMEOUT = parseInt(process.env.TIMEOUT || '120000', 10); // 120 seconds default timeout, configurable via env
const AZURE_MAX_TOKENS = parseInt(process.env.AZURE_PROXY_MAX_TOKENS || '2000', 10);
const AZURE_MAX_REQUEST_BYTES = parseInt(process.env.AZURE_PROXY_MAX_REQUEST_BYTES || '120000', 10);
const AZURE_RATE_LIMIT_WINDOW_MS = parseInt(process.env.AZURE_PROXY_RATE_LIMIT_WINDOW_MS || '60000', 10);
const AZURE_RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.AZURE_PROXY_RATE_LIMIT_MAX_REQUESTS || '10', 10);
const AZURE_SESSION_TTL_MS = parseInt(process.env.AZURE_PROXY_SESSION_TTL_MS || '1800000', 10);

const AZURE_ENDPOINT_PREFIX = '/azure-openai';

// ── Task 2: Identity & Access ─────────────────────────────────────────────
// Set AZURE_USE_MANAGED_IDENTITY=true when the proxy runs on Azure infra.
// Set AZURE_KEYVAULT_URL + AZURE_KEYVAULT_SECRET_NAME to pull the API key
// from Key Vault at session creation (requires Managed Identity).
// When neither is set, the user-provided API key is used (non-prod fallback).
const AZURE_USE_MANAGED_IDENTITY = process.env.AZURE_USE_MANAGED_IDENTITY === 'true';
const AZURE_KEYVAULT_URL = (process.env.AZURE_KEYVAULT_URL || '').trim().replace(/\/$/, '');
const AZURE_KEYVAULT_SECRET_NAME = (process.env.AZURE_KEYVAULT_SECRET_NAME || 'azure-openai-api-key').trim();

// ── Task 3: Network Security ──────────────────────────────────────────────
// Comma-separated list of allowed Azure OpenAI hostnames.
// Example: AZURE_ENDPOINT_ALLOWLIST=myresource.openai.azure.com
// When empty, any https:// endpoint is accepted (dev/test only).
const AZURE_ENDPOINT_ALLOWLIST = (process.env.AZURE_ENDPOINT_ALLOWLIST || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
// Comma-separated allowed CORS origins. Empty = allow-all (dev mode).
const PROXY_ALLOWED_ORIGINS = (process.env.PROXY_ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

// ── Task 4: Authorization & RBAC ─────────────────────────────────────────
// Comma-separated DHIS2 authority codes required to create an Azure session.
// Example: AZURE_ALLOWED_DHIS2_ROLES=AI_ANALYSIS,SUPERUSER
// Requires DHIS2_SERVER_URL to be set. Empty = no role check.
const AZURE_ALLOWED_DHIS2_ROLES = (process.env.AZURE_ALLOWED_DHIS2_ROLES || '')
  .split(',').map((r) => r.trim()).filter(Boolean);

// ── Task 5: Cost & Rate Controls ─────────────────────────────────────────
// 0 = no cap. Resets in-memory on process restart.
const AZURE_DAILY_REQUEST_CAP = parseInt(process.env.AZURE_DAILY_REQUEST_CAP || '0', 10);
const AZURE_HOURLY_REQUEST_CAP = parseInt(process.env.AZURE_HOURLY_REQUEST_CAP || '0', 10);
// Log a cost-anomaly alert when total cumulative token usage exceeds this.
const AZURE_COST_ALERT_TOKENS = parseInt(process.env.AZURE_COST_ALERT_TOKENS || '0', 10);

// ── Task 7: Kill Switch ───────────────────────────────────────────────────
// Set AZURE_AI_ENABLED=false to start with Azure disabled.
// Use POST /azure-openai/admin/toggle + AZURE_ADMIN_SECRET for runtime toggle.
let azureAiEnabled = process.env.AZURE_AI_ENABLED !== 'false';
const AZURE_ADMIN_SECRET = (process.env.AZURE_ADMIN_SECRET || '').trim();

// ── Task 8: Timeouts ─────────────────────────────────────────────────────
// Independent timeout for outbound Azure OpenAI calls (default 30 s).
const AZURE_REQUEST_TIMEOUT_MS = parseInt(process.env.AZURE_REQUEST_TIMEOUT_MS || '30000', 10);

// ── DHIS2 proxy config ────────────────────────────────────────────────────
const DHIS2_SESSION_TTL_MS = parseInt(process.env.DHIS2_PROXY_SESSION_TTL_MS || '3600000', 10);
const DHIS2_MAX_REQUEST_BYTES = parseInt(process.env.DHIS2_PROXY_MAX_REQUEST_BYTES || '5242880', 10); // 5 MB
const DHIS2_ENDPOINT_PREFIX = '/dhis2-proxy';

const dhis2CredentialStore = new Map();

// Single shared Basic auth for the DHIS2 auth-forwarding proxy (port 9091)
const DHIS2_AUTH_PROXY_PORT = parseInt(process.env.DHIS2_PROXY_PORT || '9091', 10);
const DHIS2_SERVER_URL = (process.env.DHIS2_SERVER_URL || '').replace(/\/$/, '');
let dhis2BasicAuth = null;

const azureRateLimitStore = new Map();
const azureCredentialStore = new Map();

// ── Task 2: Identity caches ───────────────────────────────────────────────
let managedIdentityTokenCache = null;   // { token, expiresAt }
let keyVaultApiKeyCache = null;         // string — refreshed on process restart

// ── Task 5: Global usage caps ─────────────────────────────────────────────
const nextMidnight = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); };
const nextHour = () => { const d = new Date(); d.setMinutes(60, 0, 0); return d.getTime(); };
const azureUsage = {
  day:  { count: 0, resetAt: nextMidnight() },
  hour: { count: 0, resetAt: nextHour() },
  totalTokens: 0,
};

const cleanupAzureRateLimitStore = () => {
  const now = Date.now();
  const cutoff = now - AZURE_RATE_LIMIT_WINDOW_MS;

  for (const [key, timestamps] of azureRateLimitStore.entries()) {
    const recent = timestamps.filter((timestamp) => timestamp > cutoff);
    if (recent.length === 0) {
      azureRateLimitStore.delete(key);
    } else {
      azureRateLimitStore.set(key, recent);
    }
  }
};

const cleanupAzureSessions = () => {
  const now = Date.now();

  for (const [sessionId, session] of azureCredentialStore.entries()) {
    if (!session || session.expiresAt <= now) {
      azureCredentialStore.delete(sessionId);
    }
  }
};

const azureRateLimitCleanupTimer = setInterval(cleanupAzureRateLimitStore, AZURE_RATE_LIMIT_WINDOW_MS);
if (typeof azureRateLimitCleanupTimer.unref === 'function') {
  azureRateLimitCleanupTimer.unref();
}

const azureSessionCleanupTimer = setInterval(cleanupAzureSessions, Math.max(30000, AZURE_RATE_LIMIT_WINDOW_MS));
if (typeof azureSessionCleanupTimer.unref === 'function') {
  azureSessionCleanupTimer.unref();
}

const cleanupDhis2Sessions = () => {
  const now = Date.now();
  for (const [id, session] of dhis2CredentialStore.entries()) {
    if (!session || session.expiresAt <= now) {
      dhis2CredentialStore.delete(id);
    }
  }
};

const dhis2SessionCleanupTimer = setInterval(cleanupDhis2Sessions, 60000);
if (typeof dhis2SessionCleanupTimer.unref === 'function') {
  dhis2SessionCleanupTimer.unref();
}

// ── Task 3: Configurable CORS origin list ────────────────────────────────
// Production: set PROXY_ALLOWED_ORIGINS to a comma-separated list of
// allowed browser origins (e.g. https://dhis2.example.com).
// Empty = allow-all (suitable for local dev/Codespaces only).
app.use(cors({
  origin: (origin, callback) => {
    if (!PROXY_ALLOWED_ORIGINS.length) return callback(null, true);
    if (!origin) return callback(null, true);  // same-origin / non-browser clients
    if (PROXY_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept',
    'X-Session-Id', 'X-Azure-Session-Id', 'X-DHIS2-Session-Id', 'X-DHIS2-Auth',
  ],
  credentials: true,
}));

// Add explicit CORS headers for all responses
app.use((req, res, next) => {
  const reqOrigin = req.headers.origin || '';
  const allowedOrigin = !PROXY_ALLOWED_ORIGINS.length || PROXY_ALLOWED_ORIGINS.includes(reqOrigin)
    ? (reqOrigin || '*')
    : '';
  if (allowedOrigin) {
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, ' +
      'X-Session-Id, X-Azure-Session-Id, X-DHIS2-Session-Id, X-DHIS2-Auth');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const createAzureSessionId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const normalizeAzureEndpoint = (value) => {
  const raw = (value || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;

    // ── Task 3: Endpoint allow-listing ───────────────────────────────────
    // If AZURE_ENDPOINT_ALLOWLIST is configured, the supplied hostname must
    // match exactly or be a subdomain of an allowed entry.
    // Private-endpoint / IP-allowlisting is enforced at the Azure network
    // layer — set "Public network access = disabled" on the Azure OpenAI
    // resource and allow the proxy's egress IP in the firewall rules.
    if (AZURE_ENDPOINT_ALLOWLIST.length > 0) {
      const host = parsed.hostname.toLowerCase();
      const allowed = AZURE_ENDPOINT_ALLOWLIST.some(
        (h) => host === h || host.endsWith('.' + h)
      );
      if (!allowed) return null;
    }

    return parsed.origin.replace(/\/$/, '');
  } catch (_) {
    return null;
  }
};

// ── Task 2: Managed Identity token helper ────────────────────────────────
// Calls the Azure Instance Metadata Service (IMDS) to get a Bearer token.
// Works only when the proxy runs inside an Azure VM / App Service / ACI.
const getManagedIdentityToken = async (resource = 'https://cognitiveservices.azure.com/') => {
  if (managedIdentityTokenCache && managedIdentityTokenCache.expiresAt > Date.now() + 60_000) {
    return managedIdentityTokenCache.token;
  }
  const imdsUrl =
    `http://169.254.169.254/metadata/identity/oauth2/token` +
    `?api-version=2018-02-01&resource=${encodeURIComponent(resource)}`;
  const resp = await fetch(imdsUrl, {
    headers: { Metadata: 'true' },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`IMDS returned HTTP ${resp.status}`);
  const data = await resp.json();
  managedIdentityTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + parseInt(data.expires_in || '3600', 10) * 1000,
  };
  return managedIdentityTokenCache.token;
};

// ── Task 2: Key Vault secret helper ──────────────────────────────────────
// Retrieves the Azure OpenAI API key from Key Vault using Managed Identity.
// Cached for the lifetime of the process.
const getKeyVaultApiKey = async () => {
  if (keyVaultApiKeyCache) return keyVaultApiKeyCache;
  if (!AZURE_KEYVAULT_URL || !AZURE_KEYVAULT_SECRET_NAME) {
    throw new Error('AZURE_KEYVAULT_URL and AZURE_KEYVAULT_SECRET_NAME must be set to use Key Vault mode.');
  }
  const token = await getManagedIdentityToken('https://vault.azure.net');
  const secretUrl = `${AZURE_KEYVAULT_URL}/secrets/${AZURE_KEYVAULT_SECRET_NAME}?api-version=7.4`;
  const resp = await fetch(secretUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Key Vault returned HTTP ${resp.status}`);
  const data = await resp.json();
  keyVaultApiKeyCache = data.value;
  console.log('[AZURE PROXY] API key loaded from Key Vault.');
  return keyVaultApiKeyCache;
};

// ── Task 4: DHIS2 RBAC check ─────────────────────────────────────────────
// Called during session creation if AZURE_ALLOWED_DHIS2_ROLES is set.
// Expects the caller to pass "X-DHIS2-Auth: Basic base64(user:pass)" header.
const checkDhis2Rbac = async (dhis2AuthHeader) => {
  if (!AZURE_ALLOWED_DHIS2_ROLES.length || !DHIS2_SERVER_URL) return { allowed: true };
  if (!dhis2AuthHeader) {
    return { allowed: false, reason: 'DHIS2 authorisation required. Pass an X-DHIS2-Auth header.' };
  }
  try {
    const resp = await fetch(`${DHIS2_SERVER_URL}/api/me?fields=username,authorities`, {
      headers: { Authorization: dhis2AuthHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { allowed: false, reason: `DHIS2 auth check failed (HTTP ${resp.status}).` };
    const me = await resp.json();
    const userRoles = Array.isArray(me.authorities) ? me.authorities : [];
    const hasRole = AZURE_ALLOWED_DHIS2_ROLES.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return {
        allowed: false,
        reason: `Access to Azure AI requires one of these DHIS2 authorities: ${AZURE_ALLOWED_DHIS2_ROLES.join(', ')}.`,
      };
    }
    return { allowed: true, userId: (me.username || '').slice(0, 64) };
  } catch (err) {
    return { allowed: false, reason: `DHIS2 role check failed: ${err.message}` };
  }
};

// ── Task 5: Usage cap helpers ────────────────────────────────────────────
const checkAndIncrementUsageCaps = (res) => {
  const now = Date.now();
  if (azureUsage.day.resetAt <= now)  azureUsage.day  = { count: 0, resetAt: nextMidnight() };
  if (azureUsage.hour.resetAt <= now) azureUsage.hour = { count: 0, resetAt: nextHour() };
  if (AZURE_DAILY_REQUEST_CAP > 0 && azureUsage.day.count >= AZURE_DAILY_REQUEST_CAP) {
    res.status(429).json({ error: { message: 'Daily Azure AI request limit reached. Resets at midnight (UTC).' } });
    return false;
  }
  if (AZURE_HOURLY_REQUEST_CAP > 0 && azureUsage.hour.count >= AZURE_HOURLY_REQUEST_CAP) {
    res.status(429).json({ error: { message: 'Hourly Azure AI request limit reached. Resets at the top of the hour.' } });
    return false;
  }
  azureUsage.day.count++;
  azureUsage.hour.count++;
  return true;
};

// ── Task 6: Structured audit logging ────────────────────────────────────
// Emits JSON lines to stdout. NEVER logs prompts, DHIS2 data values,
// API keys, session IDs, or raw user identifiers.
const auditLog = (fields = {}) => {
  const hashedUser = fields.userId
    ? crypto.createHash('sha256').update(String(fields.userId)).digest('hex').slice(0, 16)
    : null;
  const entry = {
    ts:        new Date().toISOString(),
    svc:       'azure-openai-proxy',
    event:     fields.event || 'request',
    user:      hashedUser,
    endpoint:  fields.endpoint  || null,
    status:    fields.status    != null ? fields.status : null,
    tokens:    fields.tokenCount || null,
    latencyMs: fields.latencyMs || null,
    ...(fields.adminAction ? { admin: true } : {}),
    ...(fields.error       ? { errCode: fields.error } : {}),
  };
  // Structured output — collect with your log aggregator
  console.log(JSON.stringify(entry));
  // ── Cost anomaly alert ──────────────────────────────────────────────────
  if (AZURE_COST_ALERT_TOKENS > 0 && fields.tokenCount &&
      azureUsage.totalTokens > AZURE_COST_ALERT_TOKENS) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(), svc: 'azure-openai-proxy',
      event: 'COST_ALERT',
      msg: `Cumulative token usage (${azureUsage.totalTokens}) exceeded threshold (${AZURE_COST_ALERT_TOKENS}).`,
    }));
  }
};

const validateAzureCredentialInput = (input = {}) => {
  const endpoint = normalizeAzureEndpoint(input.endpoint);
  const deploymentName = (input.deploymentName || '').trim();
  const apiVersion = (input.apiVersion || '2024-02-15-preview').trim();
  const apiKey = (input.apiKey || '').trim();

  if (!endpoint || !deploymentName || !apiVersion || !apiKey) {
    return { valid: false, error: 'Azure endpoint, deployment name, API version, and API key are required.' };
  }

  return {
    valid: true,
    credentials: {
      endpoint,
      deploymentName,
      apiVersion,
      apiKey,
    },
  };
};

const getAzureSession = (req) => {
  const azureSessionId = (req.get('x-azure-session-id') || '').trim();
  if (!azureSessionId) {
    return { azureSessionId: null, session: null };
  }

  const session = azureCredentialStore.get(azureSessionId) || null;
  if (!session) {
    return { azureSessionId, session: null };
  }

  if (session.expiresAt <= Date.now()) {
    azureCredentialStore.delete(azureSessionId);
    return { azureSessionId, session: null };
  }

  session.expiresAt = Date.now() + AZURE_SESSION_TTL_MS;
  azureCredentialStore.set(azureSessionId, session);

  return { azureSessionId, session };
};

// ── Task 8: Azure call with explicit timeout ────────────────────────────
// Uses AbortController so stalled Azure responses do not hang the proxy.
// No retries — a retry could amplify cost or abuse.
const callAzureChatCompletions = async ({ endpoint, deploymentName, apiVersion, apiKey }, body) => {
  const azureUrl = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

  // Task 2: Managed Identity mode — get Bearer token from IMDS instead of API key
  let authHeaders;
  if (AZURE_USE_MANAGED_IDENTITY) {
    const token = await getManagedIdentityToken();
    authHeaders = { Authorization: `Bearer ${token}` };
  } else {
    if (!apiKey) throw new Error('Azure API key is required when Managed Identity is not enabled.');
    authHeaders = { 'api-key': apiKey };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AZURE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(azureUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(
        new Error(`Azure OpenAI request timed out after ${AZURE_REQUEST_TIMEOUT_MS}ms.`),
        { code: 'TIMEOUT' }
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const sanitizeString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const redactedUid = value.replace(/\b[A-Za-z][A-Za-z0-9]{10}\b/g, (candidate) => {
    const hasUpper = /[A-Z]/.test(candidate);
    const hasLower = /[a-z]/.test(candidate);
    const hasDigit = /\d/.test(candidate);
    if (hasUpper && hasLower && hasDigit) {
      return '[internal identifier removed]';
    }
    return candidate;
  });

  return redactedUid.replace(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g,
    '[internal identifier removed]'
  );
};

const sanitizePayload = (payload) => {
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item));
  }

  if (!payload || typeof payload !== 'object') {
    return sanitizeString(payload);
  }

  const sanitized = {};
  Object.entries(payload).forEach(([key, value]) => {
    sanitized[key] = sanitizePayload(value);
  });

  return sanitized;
};

const enforceAzureRateLimit = (req, res, next) => {
  const sessionId = (req.get('x-azure-session-id') || '').trim() || (req.get('x-session-id') || '').trim();
  const key = sessionId || req.ip || 'unknown-client';
  const now = Date.now();
  const windowStart = now - AZURE_RATE_LIMIT_WINDOW_MS;
  const history = azureRateLimitStore.get(key) || [];
  const recentHistory = history.filter((timestamp) => timestamp > windowStart);

  if (recentHistory.length >= AZURE_RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: {
        message: 'Rate limit exceeded. Please wait before sending more Azure requests.'
      }
    });
  }

  recentHistory.push(now);
  azureRateLimitStore.set(key, recentHistory);
  next();
};

// ── Task 7: Kill-switch middleware ────────────────────────────────────────
// Applied to all Azure routes below.
const requireAzureEnabled = (req, res, next) => {
  if (!azureAiEnabled) {
    // Invalidate any session presented with this request on the way out
    const sid = (req.get('x-azure-session-id') || '').trim();
    if (sid) azureCredentialStore.delete(sid);
    return res.status(503).json({
      error: { message: 'Azure AI is currently disabled. Contact your system administrator.' },
    });
  }
  next();
};

// ── Task 7: Runtime kill-switch toggle ───────────────────────────────────
// POST /azure-openai/admin/toggle
// Body: { "secret": "<AZURE_ADMIN_SECRET>", "action": "enable" | "disable" }
app.post(`${AZURE_ENDPOINT_PREFIX}/admin/toggle`,
  express.json({ limit: '512b' }),
  (req, res) => {
    if (!AZURE_ADMIN_SECRET) {
      return res.status(403).json({ error: { message: 'Admin endpoint not configured on this proxy.' } });
    }
    const provided = (req.body?.secret || '').trim();
    if (!provided || provided !== AZURE_ADMIN_SECRET) {
      return res.status(401).json({ error: { message: 'Invalid admin secret.' } });
    }
    const action = (req.body?.action || '').toLowerCase();
    if (action !== 'enable' && action !== 'disable') {
      return res.status(400).json({ error: { message: 'action must be "enable" or "disable".' } });
    }
    azureAiEnabled = action === 'enable';
    if (!azureAiEnabled) {
      // Immediately invalidate all active sessions
      azureCredentialStore.clear();
    }
    auditLog({ event: `kill_switch_${action}`, adminAction: true });
    console.log(`[AZURE PROXY] Azure AI ${azureAiEnabled ? 'ENABLED' : 'DISABLED'} by admin.`);
    return res.json({ success: true, azureAiEnabled });
  }
);

app.post(`${AZURE_ENDPOINT_PREFIX}/session`,
  express.json({ limit: `${AZURE_MAX_REQUEST_BYTES}b` }),
  requireAzureEnabled,
  async (req, res) => {
    // ── Task 4: RBAC check ────────────────────────────────────────────────
    if (AZURE_ALLOWED_DHIS2_ROLES.length > 0 && DHIS2_SERVER_URL) {
      const rbac = await checkDhis2Rbac(req.get('x-dhis2-auth') || '');
      if (!rbac.allowed) {
        return res.status(403).json({ error: { message: rbac.reason || 'Insufficient DHIS2 permissions.' } });
      }
    }

    // ── Task 2: Key Vault — override API key from Key Vault when configured
    let body = req.body || {};
    if (AZURE_KEYVAULT_URL && AZURE_KEYVAULT_SECRET_NAME) {
      try {
        body = { ...body, apiKey: await getKeyVaultApiKey() };
      } catch (err) {
        console.error('[AZURE PROXY] Key Vault fetch failed:', err.message);
        return res.status(500).json({ error: { message: `Key Vault error: ${err.message}` } });
      }
    }

    const validation = validateAzureCredentialInput(body);
    if (!validation.valid) {
      return res.status(400).json({ error: { message: validation.error } });
    }

    const azureSessionId = createAzureSessionId();
    const expiresAt = Date.now() + AZURE_SESSION_TTL_MS;

    azureCredentialStore.set(azureSessionId, { ...validation.credentials, expiresAt });

    return res.status(201).json({ success: true, azureSessionId, expiresAt });
  }
);

app.delete(`${AZURE_ENDPOINT_PREFIX}/session`, requireAzureEnabled, (req, res) => {
  const azureSessionId = (req.get('x-azure-session-id') || '').trim();

  if (!azureSessionId) {
    return res.status(400).json({
      error: {
        message: 'Missing Azure session id.'
      }
    });
  }

  azureCredentialStore.delete(azureSessionId);

  return res.json({
    success: true,
    message: 'Azure session cleared.'
  });
});

app.post(`${AZURE_ENDPOINT_PREFIX}/session/clear`, express.json({ limit: '1024b' }), (req, res) => {
  const azureSessionId = (req.body?.azureSessionId || '').trim();
  if (azureSessionId) {
    azureCredentialStore.delete(azureSessionId);
  }

  return res.status(204).end();
});

app.get(`${AZURE_ENDPOINT_PREFIX}/test`, requireAzureEnabled, async (req, res) => {
  const { session } = getAzureSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Azure session missing or expired. Re-enter credentials to create a new session.'
    });
  }

  try {
    const azureResponse = await callAzureChatCompletions(session, {
      messages: [{ role: 'user', content: 'Connection test' }],
      max_tokens: 10,
      temperature: 0,
      n: 1,
    });

    const payloadText = await azureResponse.text();
    let payload = null;
    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (parseError) {
        payload = { error: { message: sanitizeString(payloadText) } };
      }
    }

    const sanitized = sanitizePayload(payload || { error: { message: 'Empty response from Azure OpenAI upstream.' } });

    if (!azureResponse.ok) {
      return res.status(azureResponse.status).json(sanitized);
    }

    return res.json({
      success: true,
      message: 'Azure session is valid and Azure OpenAI is reachable.',
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({
      error: {
        message: 'Failed to communicate with Azure OpenAI from proxy.'
      }
    });
  }
});

app.post(`${AZURE_ENDPOINT_PREFIX}/analyze`,
  express.json({ limit: `${AZURE_MAX_REQUEST_BYTES}b` }),
  requireAzureEnabled,
  enforceAzureRateLimit,
  async (req, res) => {
    // ── Task 5: Global hourly/daily caps ─────────────────────────────────
    if (!checkAndIncrementUsageCaps(res)) return;

    const { session } = getAzureSession(req);
    if (!session) {
      return res.status(401).json({
        error: { message: 'Azure session missing or expired. Re-enter credentials to create a new session.' },
      });
    }

    const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    if (bodySize > AZURE_MAX_REQUEST_BYTES) {
      return res.status(413).json({
        error: { message: 'Request too large. Narrow period, org unit, or indicators.' },
      });
    }

    const { messages, max_tokens, temperature, n } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { message: 'Invalid request. "messages" must be a non-empty array.' },
      });
    }

    const requestedMaxTokens = Number.isFinite(max_tokens) ? max_tokens : AZURE_MAX_TOKENS;
    const safeMaxTokens = Math.max(1, Math.min(requestedMaxTokens, AZURE_MAX_TOKENS));

    const startTime = Date.now();
    try {
      const azureResponse = await callAzureChatCompletions(session, {
        messages,
        max_tokens: safeMaxTokens,
        temperature,
        n: Number.isFinite(n) ? n : 1,
      });

      const payloadText = await azureResponse.text();
      let payload = null;
      if (payloadText) {
        try { payload = JSON.parse(payloadText); }
        catch (_) { payload = { error: { message: sanitizeString(payloadText) } }; }
      }
      const sanitized = sanitizePayload(payload || { error: { message: 'Empty response from Azure OpenAI upstream.' } });

      const tokenCount = payload?.usage?.total_tokens || null;
      if (tokenCount) azureUsage.totalTokens += tokenCount;

      // ── Task 6: Audit log ───────────────────────────────────────────────
      // Logs metadata only — no prompts, no data values, no API keys.
      auditLog({
        event: 'analyze',
        endpoint: session.endpoint,
        status: azureResponse.status,
        tokenCount,
        latencyMs: Date.now() - startTime,
      });

      if (!azureResponse.ok) return res.status(azureResponse.status).json(sanitized);
      return res.json(sanitized);
    } catch (error) {
      // ── Task 8: Surface timeout as 504 ──────────────────────────────────
      if (error.code === 'TIMEOUT') {
        auditLog({ event: 'analyze_timeout', endpoint: session.endpoint, latencyMs: Date.now() - startTime, error: 'timeout' });
        return res.status(504).json({ error: { message: error.message } });
      }
      auditLog({ event: 'analyze_error', endpoint: session.endpoint, latencyMs: Date.now() - startTime, error: 'upstream_error' });
      console.error('[AZURE PROXY] Error:', error.message);
      return res.status(500).json({ error: { message: 'Failed to communicate with Azure OpenAI from proxy.' } });
    }
  }
);

// ---------------------------------------------------------------------------
// DHIS2 Proxy routes
// ---------------------------------------------------------------------------

const getDhis2Session = (req) => {
  const id = (req.get('x-dhis2-session-id') || '').trim();
  if (!id) return null;
  const session = dhis2CredentialStore.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    dhis2CredentialStore.delete(id);
    return null;
  }
  // Slide expiry on use
  session.expiresAt = Date.now() + DHIS2_SESSION_TTL_MS;
  dhis2CredentialStore.set(id, session);
  return session;
};

// POST /dhis2-proxy/session — create in-memory DHIS2 session
app.post(`${DHIS2_ENDPOINT_PREFIX}/session`, express.json({ limit: '10kb' }), async (req, res) => {
  const serverUrl = (req.body?.serverUrl || '').trim().replace(/\/$/, '');
  const username = (req.body?.username || '').trim();
  const password = (req.body?.password || '');

  if (!serverUrl || !username || !password) {
    return res.status(400).json({ error: { message: 'serverUrl, username, and password are required.' } });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(serverUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Bad protocol');
    }
  } catch {
    return res.status(400).json({ error: { message: 'Invalid serverUrl — must be an http/https URL.' } });
  }

  // Test credentials against the DHIS2 server before creating the session
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  try {
    const testRes = await fetch(`${serverUrl}/api/me`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!testRes.ok) {
      return res.status(testRes.status).json({
        error: { message: `DHIS2 authentication failed (HTTP ${testRes.status}). Check your credentials.` },
      });
    }
  } catch (err) {
    return res.status(502).json({
      error: { message: `Cannot reach DHIS2 server: ${err.message}` },
    });
  }

  const sessionId = createAzureSessionId();
  dhis2CredentialStore.set(sessionId, { serverUrl, authHeader, expiresAt: Date.now() + DHIS2_SESSION_TTL_MS });

  return res.status(201).json({ success: true, sessionId, expiresAt: Date.now() + DHIS2_SESSION_TTL_MS });
});

// DELETE /dhis2-proxy/session — clear session
app.delete(`${DHIS2_ENDPOINT_PREFIX}/session`, (req, res) => {
  const id = (req.get('x-dhis2-session-id') || '').trim();
  if (id) dhis2CredentialStore.delete(id);
  return res.json({ success: true, message: 'DHIS2 session cleared.' });
});

// GET /dhis2-proxy/test — validate existing session
app.get(`${DHIS2_ENDPOINT_PREFIX}/test`, async (req, res) => {
  const session = getDhis2Session(req);
  if (!session) {
    return res.status(401).json({ success: false, message: 'DHIS2 session missing or expired. Please log in again.' });
  }

  try {
    const testRes = await fetch(`${session.serverUrl}/api/me`, {
      headers: { Authorization: session.authHeader, Accept: 'application/json' },
    });
    if (!testRes.ok) {
      return res.status(testRes.status).json({ success: false, message: 'DHIS2 session invalid.' });
    }
    const me = await testRes.json();
    return res.json({ success: true, username: me.username, expiresAt: session.expiresAt });
  } catch (err) {
    return res.status(502).json({ success: false, message: `Cannot reach DHIS2 server: ${err.message}` });
  }
});

// ALL /dhis2-proxy/* — forward requests to DHIS2 server
app.all(`${DHIS2_ENDPOINT_PREFIX}/*`, express.raw({ type: '*/*', limit: `${DHIS2_MAX_REQUEST_BYTES}b` }), async (req, res) => {
  const session = getDhis2Session(req);
  if (!session) {
    return res.status(401).json({ error: { message: 'DHIS2 session missing or expired. Please log in again.' } });
  }

  // Strip the /dhis2-proxy prefix to get the real API path (with query string)
  const apiPath = req.url.replace(/^\/dhis2-proxy/, '');
  const targetUrl = `${session.serverUrl}${apiPath}`;

  const forwardHeaders = {};
  const copyHeaders = ['content-type', 'accept', 'accept-language', 'cache-control'];
  copyHeaders.forEach((h) => { if (req.get(h)) forwardHeaders[h] = req.get(h); });
  forwardHeaders['Authorization'] = session.authHeader;

  const fetchOptions = { method: req.method, headers: forwardHeaders };
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0 && !['GET', 'HEAD'].includes(req.method)) {
    fetchOptions.body = req.body;
  }

  try {
    const upstream = await fetch(targetUrl, fetchOptions);
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());

    upstream.headers.forEach((value, key) => {
      // Skip hop-by-hop and CORS headers — proxy sets its own
      const skip = ['transfer-encoding', 'connection', 'keep-alive', 'access-control-allow-origin',
        'access-control-allow-methods', 'access-control-allow-headers'];
      if (!skip.includes(key.toLowerCase())) {
        try { res.setHeader(key, value); } catch (_) {}
      }
    });

    return res.status(upstream.status).end(responseBuffer);
  } catch (err) {
    console.error('[DHIS2 PROXY] Error:', err.message);
    return res.status(502).json({ error: { message: `Failed to reach DHIS2 server: ${err.message}` } });
  }
});

// POST /dhis2-proxy/set-basic-auth
// Called by the browser login form to store Basic auth for all proxied DHIS2 requests
app.post(`${DHIS2_ENDPOINT_PREFIX}/set-basic-auth`, express.json({ limit: '1kb' }), async (req, res) => {
  const username = (req.body?.username || '').trim();
  const password = (req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: { message: 'username and password are required.' } });
  }
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  if (DHIS2_SERVER_URL) {
    try {
      const testRes = await fetch(`${DHIS2_SERVER_URL}/api/me`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!testRes.ok) {
        return res.status(testRes.status).json({
          error: { message: `DHIS2 authentication failed (HTTP ${testRes.status}). Check your credentials.` },
        });
      }
    } catch (err) {
      return res.status(502).json({ error: { message: `Cannot reach DHIS2 server: ${err.message}` } });
    }
  }
  dhis2BasicAuth = auth;
  return res.json({ success: true, message: 'DHIS2 auth set on proxy.' });
});

// GET /dhis2-proxy/auth-status — check if proxy auth is currently set
app.get(`${DHIS2_ENDPOINT_PREFIX}/auth-status`, (req, res) => {
  return res.json({ authenticated: Boolean(dhis2BasicAuth), server: DHIS2_SERVER_URL || null });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Local AI proxy is running' });
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
    console.log(`[PROXY] Response from Ollama upstream: ${proxyRes.statusCode}`);
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

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        message: 'Request too large. Narrow period, org unit, or indicators.'
      }
    });
  }

  return next(err);
});

// Add a catch-all route for debugging
app.use('*', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Local AI proxy server is running',
    help: 'Use the provider-specific endpoints for local development testing.',
    config: {
      port: PORT,
      timeout: TIMEOUT + 'ms'
    },
    endpoints: {
      '/health': 'Health check endpoint',
      '/azure-openai/admin/toggle': 'Runtime kill-switch toggle (requires AZURE_ADMIN_SECRET)',
      '/azure-openai/session': 'Create Azure in-memory session from UI credentials',
      '/azure-openai/session/clear': 'Best-effort session cleanup for browser unload',
      '/azure-openai/test': 'Validate Azure session and upstream connectivity',
      '/azure-openai/analyze': 'Azure analysis endpoint (requires session id)'
    },
    usage: {
      setCustomTimeout: 'Run with TIMEOUT=90000 node proxy.js for a 90 second timeout',
      setCustomPort: 'Run with PORT=8080 node proxy.js to use port 8080'
    }
  });
});

// ---------------------------------------------------------------------------
// DHIS2 auth-injecting reverse proxy on DHIS2_AUTH_PROXY_PORT (default 9091)
// Vite forwards /api/* to this server; it injects Authorization and forwards
// to DHIS2_SERVER_URL.
// ---------------------------------------------------------------------------
const dhis2AuthProxy = coreHttp.createServer((req, res) => {
  const replyError = (status, message) => {
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: message }));
  };

  if (!DHIS2_SERVER_URL) return replyError(503, 'DHIS2_SERVER_URL not configured on proxy.');
  if (!dhis2BasicAuth) return replyError(401, 'Not authenticated. Please log in via the app.');

  let targetUrl;
  try {
    targetUrl = new URL(DHIS2_SERVER_URL + req.url);
  } catch {
    return replyError(400, 'Bad request URL.');
  }

  const outHeaders = {};
  ['content-type', 'accept', 'accept-language', 'content-length'].forEach((h) => {
    if (req.headers[h]) outHeaders[h] = req.headers[h];
  });
  outHeaders['authorization'] = dhis2BasicAuth;
  outHeaders['host'] = targetUrl.host;

  const transport = targetUrl.protocol === 'https:' ? coreHttps : coreHttp;
  const proxyReq = transport.request(
    {
      method: req.method,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + (targetUrl.search || ''),
      headers: outHeaders,
      rejectUnauthorized: false,
    },
    (proxyRes) => {
      const resHeaders = {};
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        if (!['transfer-encoding', 'connection', 'keep-alive'].includes(k.toLowerCase())) {
          resHeaders[k] = v;
        }
      });
      if (resHeaders.location) {
        try {
          const loc = new URL(resHeaders.location);
          if (loc.hostname === targetUrl.hostname) {
            resHeaders.location = loc.pathname + (loc.search || '');
          }
        } catch (_) {}
      }
      res.writeHead(proxyRes.statusCode, resHeaders);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', (err) => replyError(502, `Proxy error: ${err.message}`));
  req.pipe(proxyReq, { end: true });
});

dhis2AuthProxy.listen(DHIS2_AUTH_PROXY_PORT, () => {
  console.log(`DHIS2 auth proxy running on port ${DHIS2_AUTH_PROXY_PORT} → ${DHIS2_SERVER_URL || '(no DHIS2_SERVER_URL set)'}`);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Local AI Proxy Server running on port ${PORT}`);
  console.log(`Using timeout of ${TIMEOUT}ms for local upstream requests`);
  console.log(`Use this URL in your DHIS2 AI Insights app: http://localhost:${PORT}`);
  console.log(`Test the proxy with: curl http://localhost:${PORT}/health`);
  console.log(`Check available Ollama models with: curl http://localhost:${PORT}/api/tags`);
  console.log(`\nTo set a custom timeout: TIMEOUT=90000 node proxy.js (for 90 seconds)`);
});