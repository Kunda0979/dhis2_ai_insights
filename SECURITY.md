# Security Reference — DHIS2 AI Insights

> **Audience**: IT/Security reviewers, system administrators, deployment engineers.

---

## 1. Azure OpenAI Security Model

### Architecture

```
Browser (DHIS2 App)
  │  X-Azure-Session-Id header
  ▼
AI Proxy  (ollama-proxy/proxy.js)
  │  api-key / Bearer token   [API key never leaves the proxy host]
  ▼
Azure OpenAI REST API
```

The browser **never** holds an API key or calls Azure OpenAI directly. All requests
are mediated by the AI proxy, which:

- Validates each session token on every request
- Enforces token-per-request limits, rate limits, and (optionally) daily/hourly caps
- Applies a configurable outbound timeout to every Azure call
- Emits structured audit logs that never include prompts or data values

---

## 2. Credential Handling Guarantees

| Item | Guarantee |
|---|---|
| Azure API key at rest | Stored only in proxy process memory. Never written to disk, a database, or browser storage. |
| What the browser stores | A short-lived **session ID** only (no secrets). Stored in DHIS2 User Data Store when deployed, or tab-scoped `sessionStorage` in dev. |
| Session expiry | 30-minute idle timeout; resets on each AI query. Proxy enforces this independently of the browser. |
| Key Vault mode | When `AZURE_KEYVAULT_URL` is set the proxy fetches the API key from Azure Key Vault at startup using Managed Identity — no key in env vars at all. |
| Managed Identity mode | When `AZURE_USE_MANAGED_IDENTITY=true` the proxy calls Azure OpenAI with a short-lived IMDS Bearer token; no long-lived API key is needed in production. |

---

## 3. Network Isolation Assumptions

For a production deployment:

1. **Private Endpoint (recommended)**: Disable public network access on the Azure OpenAI resource. Create a Private Endpoint so only the proxy host's VNet can reach Azure OpenAI.
2. **IP Allowlisting (alternative)**: Set `AZURE_ENDPOINT_ALLOWLIST` to the expected Azure OpenAI hostname(s). The proxy will reject session creation if the endpoint is not on the list.
3. **Proxy origin restriction**: Set `PROXY_ALLOWED_ORIGINS` to the DHIS2 server origin (e.g. `https://dhis2.example.com`). The proxy refuses cross-origin requests from unlisted origins.
4. **Browser → Azure blocked**: Because Azure OpenAI's network policy is restricted to the proxy host, a browser cannot call Azure OpenAI directly even if it tried.

---

## 4. Authorization & RBAC

| Env var | Purpose |
|---|---|
| `AZURE_ALLOWED_DHIS2_ROLES` | Comma-separated DHIS2 authority codes required to create an Azure session. Empty = no role check. |
| `DHIS2_SERVER_URL` | Required when RBAC is enabled. The proxy calls `/api/me` on this server to verify the user's authorities. |

When RBAC is active, the frontend must pass `X-DHIS2-Auth: Basic <base64(user:pass)>` when
creating an Azure session. Failures return `401` / `403` with no sensitive detail.

---

## 5. Rate Limiting & Cost Controls

| Control | Scope | Env var |
|---|---|---|
| Per-session rate limit | 10 req / 60 s (default) | `AZURE_PROXY_RATE_LIMIT_MAX_REQUESTS`, `AZURE_PROXY_RATE_LIMIT_WINDOW_MS` |
| Request size limit | 120 KB body (default) | `AZURE_PROXY_MAX_REQUEST_BYTES` |
| Token limit per response | 2 000 tokens (default) | `AZURE_PROXY_MAX_TOKENS` |
| Hourly global cap | ∞ (disabled by default) | `AZURE_HOURLY_REQUEST_CAP` |
| Daily global cap | ∞ (disabled by default) | `AZURE_DAILY_REQUEST_CAP` |
| Cost-anomaly alert | Log warning above threshold | `AZURE_COST_ALERT_TOKENS` |

All limits fail safely with `429` responses and clear messages. No retries are issued.

---

## 6. Logging & Auditability

The proxy emits **structured JSON** audit lines to stdout, e.g.:

```json
{"ts":"2026-05-05T12:00:00.000Z","svc":"azure-openai-proxy","event":"analyze",
 "user":"a3f4b2c1d5e6f7a8","endpoint":"https://resource.openai.azure.com",
 "status":200,"tokens":412,"latencyMs":1832}
```

Fields **never** present in logs:

- Prompts or DHIS2 data values
- Azure API keys
- Session IDs
- Raw usernames (hashed with SHA-256, first 16 hex chars only)

**Retention**: Logs are written to stdout only. Configure retention in your log aggregation
system (e.g. Azure Monitor, Splunk, Loki). Recommended retention: ≥ 90 days.

---

## 7. Kill Switch

Azure AI can be disabled instantly without a code deployment:

```bash
# Via environment variable (requires process restart):
AZURE_AI_ENABLED=false

# Via admin API (no restart needed; requires AZURE_ADMIN_SECRET to be set):
curl -X POST https://proxy.example.com/azure-openai/admin/toggle \
  -H "Content-Type: application/json" \
  -d '{"secret":"<AZURE_ADMIN_SECRET>","action":"disable"}'
```

When disabled:
- All Azure endpoints return `503 Service Unavailable`
- All active sessions are immediately invalidated
- An audit log entry is emitted

---

## 8. Timeouts & Reliability

| Env var | Default | Purpose |
|---|---|---|
| `AZURE_REQUEST_TIMEOUT_MS` | `30000` (30 s) | Hard timeout on every outbound Azure call via `AbortController`. Returns `504` on expiry. |
| `TIMEOUT` | `120000` (120 s) | General socket timeout for Ollama and other proxied calls. |

Timed-out requests return `504 Gateway Timeout` with a user-friendly message. No retries
are issued by the proxy — retry decisions belong to the operator.

---

## 9. Security Sign-Off Checklist

- [ ] Proxy deployed behind TLS (HTTPS) termination
- [ ] `PROXY_ALLOWED_ORIGINS` set to the DHIS2 server origin
- [ ] `AZURE_ENDPOINT_ALLOWLIST` set to the expected Azure OpenAI hostname
- [ ] Azure OpenAI resource has public network access **disabled** (Private Endpoint or IP allowlist active)
- [ ] `AZURE_USE_MANAGED_IDENTITY=true` and `AZURE_KEYVAULT_URL` configured (no API key in env)
- [ ] `AZURE_AI_ENABLED` / `AZURE_ADMIN_SECRET` set for kill-switch readiness
- [ ] `AZURE_DAILY_REQUEST_CAP` / `AZURE_HOURLY_REQUEST_CAP` set to match budget
- [ ] Proxy stdout collected by a log aggregator with ≥ 90-day retention
- [ ] `AZURE_ALLOWED_DHIS2_ROLES` populated if role-based access is required
- [ ] Secrets rotated quarterly (see INCIDENT_RESPONSE.md)

---

## 10. Azure OpenAI Data Privacy & Training Controls

### No training on customer data — guaranteed by Microsoft

This application uses **Azure OpenAI Service** (`*.openai.azure.com`), not the public
OpenAI API (`api.openai.com`). This distinction carries enforceable enterprise privacy
guarantees.

| Guarantee | Detail |
|---|---|
| **No model training** | Microsoft will not use your prompts, completions, embeddings, or training data to train, retrain, or improve Azure OpenAI or any other Microsoft/OpenAI model. |
| **No data sharing with OpenAI** | Data processed through Azure OpenAI stays within your Azure subscription. It is not accessible to OpenAI. |
| **Data residency** | Requests are processed in the Azure region you selected when provisioning the OpenAI resource. No cross-region data transfer occurs without your configuration. |
| **Enterprise DPA** | Microsoft's Data Processing Addendum and GDPR commitments apply to all data processed by the Azure OpenAI Service. |
| **Reference** | [Microsoft Azure OpenAI Data Privacy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) |

> **Note**: Opt-in abuse monitoring may be enabled by Microsoft on some Azure deployments.
> If your organisation handles data that must never be inspected, request an exemption or
> deploy behind a Private Endpoint with no internet egress.

### How the application reinforces the guarantee

Beyond Microsoft's contractual commitment, the application enforces no-retention at every
layer:

| Layer | Control |
|---|---|
| **Proxy logs** | `auditLog()` records only: timestamp, event type, hashed user ID, token count, latency, HTTP status. Prompts and DHIS2 data values are **never** written to logs. |
| **Proxy memory** | Only Azure credentials and session IDs are held in memory. No message content is cached server-side. |
| **Browser storage** | Only a session ID is persisted (DHIS2 userDataStore). No prompts, responses, or health data are stored client-side. |
| **Database** | The application writes nothing to a database. DHIS2 userDataStore stores only `{ sessionId, proxyUrl }`. |
| **Files** | No prompt content is written to any file on the proxy host or the DHIS2 server. |

### Confirming Azure vs public OpenAI at runtime

The proxy enforces that all requests go to an Azure endpoint. The session creation endpoint
validates that the supplied endpoint hostname matches the `AZURE_ENDPOINT_ALLOWLIST` (if set)
and that the URL structure is `https://<resource>.openai.azure.com/...`. Requests to
`api.openai.com` or any non-Azure host can be blocked by setting the allowlist.

### Statement for IT/security reviewers

> "DHIS2 AI Insights sends health data queries to Azure OpenAI Service under Sightsavers'
> Azure subscription. Microsoft's Azure OpenAI Service contractually guarantees that
> customer prompts and responses are not used to train or improve any AI model, and data
> is not shared with OpenAI. The application additionally ensures no prompt or response
> text is written to logs, databases, or files at any layer. All processing occurs within
> the designated Azure region. Evidence is available in SECURITY.md §10, the proxy source
> code comments in `ollama-proxy/proxy.js` (`callAzureChatCompletions`), and Microsoft's
> published data privacy documentation."

