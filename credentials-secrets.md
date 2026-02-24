# Credentials & Secrets

## 1. Credential Storage Map

| What | Path | Format |
|------|------|--------|
| WhatsApp creds | `~/.openclaw/credentials/whatsapp/<accountId>/creds.json` | JSON |
| Telegram bot token | config/env or `channels.telegram.tokenFile` | String |
| Discord bot token | config/env | String |
| Slack tokens | config/env (`channels.slack.*`) | String |
| Pairing allowlists | `~/.openclaw/credentials/<channel>-allowFrom.json` | JSON array |
| Pairing requests | `~/.openclaw/credentials/<channel>-pairing.json` | JSON |
| Model auth profiles | `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` | JSON |
| Legacy OAuth import | `~/.openclaw/credentials/oauth.json` | JSON |
| Device identity | `~/.openclaw/identity/device.json` | Ed25519 keypair |
| Session transcripts | `~/.openclaw/agents/<agentId>/sessions/*.jsonl` | JSONL |
| Session metadata | `~/.openclaw/agents/<agentId>/sessions/sessions.json` | JSON |
| Gateway config | `~/.openclaw/openclaw.json` | JSON5 |
| Installed plugins | `~/.openclaw/extensions/<pluginId>/` | Directory |
| Sandbox workspaces | `~/.openclaw/sandboxes/` | Directory |

## 2. File Permission Model

The `fixSecurityFootguns()` function (and `openclaw security audit --fix`) applies:

| Path | POSIX Mode | Purpose |
|------|-----------|---------|
| `~/.openclaw/` | 0o700 | No group/world access |
| `openclaw.json` | 0o600 | Owner read/write only |
| `credentials/` | 0o700 | No group/world access |
| Credential JSON files | 0o600 | Owner read/write only |
| Agent root dirs | 0o700 | Per-agent isolation |
| `sessions.json` | 0o600 | Session metadata |
| Session transcripts | 0o600 | Conversation logs |
| Config include files | 0o600 | Imported config fragments |
| `identity/device.json` | 0o600 | Device keypair |
| `auth-profiles.json` | 0o600 | API keys/OAuth tokens |

Windows uses equivalent ICACLs. Symlinks are SKIPPED (not followed) to prevent TOCTOU attacks.

Pi's auth.json also uses 0o600 with file locking (proper-lockfile, 30s stale detection, compromise detection).

## 3. Sensitive Data on Disk

Session transcripts can contain: pasted secrets, file contents, command output, URLs, tool args. Redaction applies only to tool summaries/status output, NOT raw transcripts.

Anything under `~/.openclaw/` may contain secrets or private data. Treat disk access as the trust boundary.

Recommendations:
- Full-disk encryption on gateway host
- Dedicated OS user for the Gateway on shared hosts
- Prune old transcripts and logs

## 4. Logging & Redaction

`logging.redactSensitive` modes:
- `"tools"` (default): redacts sensitive patterns in tool output/summaries
- `"off"`: no redaction (flagged by security audit)

Masking algorithm: tokens < 18 chars -> `***`; longer -> first 6 + `…` (U+2026) + last 4.

17 default redaction patterns covering:
- ENV assignments (KEY=, TOKEN=, SECRET=, PASSWORD=)
- JSON fields ("apiKey", "token", "secret", etc.)
- CLI flags (--api-key, --token, --secret, --password)
- Authorization/Bearer headers
- PEM private key blocks
- Token prefixes: sk-\*, ghp\_\*, github\_pat\_\*, xox[baprs]-\*, xapp-\*, gsk\_\*, AIza\*, pplx-\*, npm\_\*
- Telegram bot tokens (bot\<digits\>:\<alphanumeric\>)
- Bare Telegram tokens (`\b(\d{6,}:[A-Za-z0-9_-]{20,})\b`)

Custom patterns via `logging.redactPatterns`: accepts regex strings or `/pattern/flags`. Custom patterns REPLACE (not augment) defaults.

## 5. Gateway Credential Resolution

Server-side (gateway startup): config -> env `OPENCLAW_GATEWAY_TOKEN` (no legacy fallback; `includeLegacyEnv: false`)
Client-side (connecting to remote): env `OPENCLAW_GATEWAY_TOKEN` -> legacy `CLAWDBOT_GATEWAY_TOKEN` -> config (env-first, with legacy fallback)

Hook token: via `Authorization: Bearer <token>` or `X-OpenClaw-Token` header. Must differ from gateway auth token (enforced at startup).

Auto-generated token: 48 hex chars (24 random bytes) if no token configured. Persisted to config.

## 6. Environment Variable Sanitization (Sandbox)

Before passing env vars to Docker containers:
- Blocked: ANTHROPIC\_API\_KEY, OPENAI\_API\_KEY, GEMINI\_API\_KEY, OPENROUTER\_API\_KEY, MINIMAX\_API\_KEY, COHERE\_API\_KEY, AI\_GATEWAY\_API\_KEY, AZURE\_API\_KEY, AZURE\_OPENAI\_API\_KEY, ELEVENLABS\_API\_KEY, SYNTHETIC\_API\_KEY, TELEGRAM\_BOT\_TOKEN, DISCORD\_BOT\_TOKEN, SLACK\_(BOT|APP)\_TOKEN, LINE\_CHANNEL\_SECRET, LINE\_CHANNEL\_ACCESS\_TOKEN, AWS\_SECRET\_ACCESS\_KEY, AWS\_SECRET\_KEY, AWS\_SESSION\_TOKEN, GH\_TOKEN, GITHUB\_TOKEN, OPENCLAW\_GATEWAY\_TOKEN, OPENCLAW\_GATEWAY\_PASSWORD
- Generic pattern: `/_?(API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|SECRET)$/i`
- Null bytes -> blocked
- Values > 32768 chars -> warned (not blocked; variable still passes through)
- Strict mode: only LANG, LC\_\*, PATH, HOME, USER, SHELL, TERM, TZ, NODE\_ENV

## 7. Secret Scanning (detect-secrets)

CI runs `detect-secrets scan --baseline .secrets.baseline`. For real secrets: rotate/remove, re-scan. For false positives: `detect-secrets audit .secrets.baseline` (interactive).

## 8. Credential Rotation Checklist

1. Generate new secret (gateway.auth.token or OPENCLAW\_GATEWAY\_PASSWORD)
2. Restart Gateway
3. Update remote clients (gateway.remote.token/.password)
4. Verify old credentials rejected

## 9. Incident Response -- Credential Scope

If compromise suspected:
- Rotate gateway auth token/password
- Rotate remote client secrets
- Rotate provider/API credentials (WhatsApp, Slack/Discord tokens, API keys in auth-profiles.json)
- Check Gateway logs: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- Review transcripts: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
