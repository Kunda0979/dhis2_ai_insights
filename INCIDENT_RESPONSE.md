# Incident Response Runbook — DHIS2 AI Insights (Azure OpenAI)

> For system administrators and security responders.
> Keep this document accessible offline (print or save separately before an incident).

---

## 1. Immediately Disable Azure AI

### Option A — Environment variable (requires proxy restart)

```bash
# Set in your deployment config / .env file
AZURE_AI_ENABLED=false

# Then restart the proxy process
pm2 restart ai-proxy          # PM2
systemctl restart ai-proxy    # systemd
# Or redeploy the container
```

### Option B — Live admin API (no restart; recommended for immediate response)

```bash
curl -X POST https://<proxy-host>/azure-openai/admin/toggle \
  -H "Content-Type: application/json" \
  -d '{"secret":"<AZURE_ADMIN_SECRET>","action":"disable"}'
# Returns: {"success":true,"azureAiEnabled":false}
```

**Effect**: All Azure endpoints return `503`. All active sessions are immediately invalidated.
An audit log entry with `event: kill_switch_disable` is emitted.

### To re-enable

```bash
curl -X POST https://<proxy-host>/azure-openai/admin/toggle \
  -H "Content-Type: application/json" \
  -d '{"secret":"<AZURE_ADMIN_SECRET>","action":"enable"}'
```

---

## 2. Rotate Azure OpenAI API Key

### API-key mode

1. Generate a new API key in Azure Portal → Azure OpenAI resource → Keys and Endpoint.
2. Update the env var or startup script on the proxy host:
   ```
   # If the key is passed as an env var at session creation, no action needed —
   # users re-enter credentials in Settings after restarting the proxy.
   ```
3. Restart the proxy to clear the in-memory credential store:
   ```bash
   pm2 restart ai-proxy
   ```
4. Revoke the old key in Azure Portal.

### Key Vault mode (`AZURE_KEYVAULT_URL` set)

1. Create a new secret version in Key Vault.
2. Restart the proxy — `keyVaultApiKeyCache` is cleared on restart, so the new
   secret is fetched automatically on the next session creation.
3. Disable the old secret version in Key Vault.

### Managed Identity mode (`AZURE_USE_MANAGED_IDENTITY=true`)

No API key to rotate. Token expiry is handled automatically by IMDS (≤ 1 hour tokens).
If the Managed Identity itself is compromised, revoke it in Azure IAM and assign a new one.

---

## 3. Rotate the Admin Secret

1. Generate a new random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update `AZURE_ADMIN_SECRET` in your deployment config.
3. Restart the proxy.
4. Verify the old secret no longer works:
   ```bash
   curl -X POST https://<proxy-host>/azure-openai/admin/toggle \
     -H "Content-Type: application/json" \
     -d '{"secret":"<OLD_SECRET>","action":"enable"}'
   # Should return 401
   ```

---

## 4. Review Audit Logs Safely

Logs are written to proxy stdout in JSON-line format. Collect them from your aggregator
(Azure Monitor, CloudWatch, Splunk, Loki, etc.).

```bash
# Grep for Azure AI events in the last hour (local file example)
grep '"svc":"azure-openai-proxy"' /var/log/ai-proxy.log | \
  jq 'select(.ts > "2026-05-05T11:00:00Z")'

# Find all analyze requests with latency > 5 s
grep '"event":"analyze"' /var/log/ai-proxy.log | \
  jq 'select(.latencyMs > 5000)'

# Check for cost-anomaly alerts
grep '"event":"COST_ALERT"' /var/log/ai-proxy.log
```

**Safe fields to share with third parties:**
`ts`, `svc`, `event`, `status`, `tokens`, `latencyMs`, `errCode`, `user` (hashed only)

**Never share:**
prompts, DHIS2 data values, API keys, session IDs, raw usernames.

---

## 5. Session Invalidation (Non-emergency)

To clear a specific inactive user's session without disrupting others, restart the proxy.
All in-memory sessions are lost on restart; users re-authenticate by saving credentials
again in Settings.

For immediate single-session invalidation:
```bash
# The user's session ID is not exposed in the UI.
# Use the kill-switch disable + re-enable cycle to clear all sessions at once.
curl -X POST https://<proxy-host>/azure-openai/admin/toggle \
  -H "Content-Type: application/json" \
  -d '{"secret":"<AZURE_ADMIN_SECRET>","action":"disable"}'

curl -X POST https://<proxy-host>/azure-openai/admin/toggle \
  -H "Content-Type: application/json" \
  -d '{"secret":"<AZURE_ADMIN_SECRET>","action":"enable"}'
```

---

## 6. Post-Incident Checklist

- [ ] Azure AI disabled during investigation
- [ ] API key rotated (old key revoked in Azure Portal)
- [ ] Admin secret rotated
- [ ] Audit logs exported and preserved
- [ ] Root cause identified (check logs for anomalous `user` hashes, `latencyMs` spikes, unusual `tokens`)
- [ ] DHIS2 User Data Store entries cleared if compromise of session IDs is suspected:
  ```
  DELETE /api/userDataStore/dhis2-ai-insights   (DHIS2 superuser or API)
  ```
- [ ] Azure AI re-enabled after remediation
- [ ] Post-incident report written
