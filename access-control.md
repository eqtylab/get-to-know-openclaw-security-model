# OpenClaw Access Control Reference

This document is a comprehensive technical reference covering the two major security
domains in OpenClaw: **gateway authentication** (how callers prove their identity to
the gateway) and **channel access control** (how inbound messages are filtered before
reaching the bot).

---

## Part 1: Gateway Authentication

The gateway is the central coordination process. Every WebSocket connection and HTTP
API call must pass authentication before the gateway will process it. The design
principle is **fail-closed**: if the gateway cannot determine a valid auth
configuration at startup, it refuses to start.

### 1.1 Auth Modes

The `GatewayAuthMode` enum defines four explicit modes. The active mode is selected
through a resolution chain (see [1.5 Auth Mode Resolution Priority](#15-auth-mode-resolution-priority)).

| Mode | Config value | Primary use case |
|---|---|---|
| Token | `"token"` | Default. Shared bearer token for programmatic access. |
| Password | `"password"` | Human-facing access, required for Tailscale Funnel. |
| Trusted proxy | `"trusted-proxy"` | Reverse-proxy deployments (nginx, Caddy, etc.). |
| None | `"none"` | **WARNING: Most dangerous setting.** Accepts all connections without any authentication. |

#### 1.1.1 Token Auth

```yaml
gateway:
  auth:
    mode: "token"
    token: "your-secret-token-here"
```

- The token can also be supplied via the environment variable `OPENCLAW_GATEWAY_TOKEN`.
- Token comparison uses **timing-safe SHA-256 hashing** through the `safeEqualSecret`
  function in `src/security/secret-equal.ts`. Both the supplied and expected values
  are hashed with SHA-256 before comparison, preventing timing side-channels.
- If no token is configured at startup, the gateway **auto-generates** a 48-hex-char
  random token and persists it to the config store. Subsequent restarts reuse the
  persisted value.
- Requests are rate-limited per source IP (see [1.8 Rate Limiting](#18-rate-limiting)).

#### 1.1.2 Password Auth

```yaml
gateway:
  auth:
    mode: "password"
    password: "your-password-here"
```

- The password can also be supplied via `OPENCLAW_GATEWAY_PASSWORD`.
- Uses the same `safeEqualSecret` timing-safe comparison as token auth.
- **Required** when using Tailscale Funnel (publicly-routable Tailscale ingress),
  because Funnel strips Tailscale identity headers. The gateway enforces this at
  startup validation.

#### 1.1.3 Trusted Proxy Auth

```yaml
gateway:
  trustedProxies:
    - "10.0.0.0/8"
    - "172.16.0.0/12"
  auth:
    mode: "trusted-proxy"
    requiredHeaders:
      - "X-Forwarded-For"
      - "X-Real-IP"
    userHeader: "X-Forwarded-User"
    allowUsers:
      - "alice@example.com"
      - "bob@example.com"
```

| Setting | Required | Description |
|---|---|---|
| `trustedProxies` | Yes | List of proxy IPs or CIDR ranges. Must be non-empty. |
| `requiredHeaders` | Yes | All listed headers must be present on the request. |
| `userHeader` | Yes | Header containing the authenticated identity. |
| `allowUsers` | No | When set, only these identities are accepted. Omit to allow any identity the proxy vouches for. |

**Startup validation rules:**

- `trustedProxies` must be non-empty; the gateway refuses to start otherwise.
- If the gateway is bound to a loopback address, at least one entry in
  `trustedProxies` must be a loopback address (e.g., `127.0.0.1` or `::1`).

#### 1.1.4 None

```yaml
gateway:
  auth:
    mode: "none"
```

- **WARNING:** The gateway **accepts all WebSocket connections without any
  authentication**. The auth handler returns `{ ok: true, method: "none" }` for
  every request. This is the most dangerous setting — any client can connect and
  interact with the gateway without proving identity.
- Use this mode only in fully isolated environments (e.g., localhost-only binds
  behind a separate authentication layer). Combining with `allowTailscale` can
  provide an alternate identity path, but mode `"none"` itself performs no
  authentication whatsoever.

### 1.2 Tailscale Identity Auth (Implicit)

Tailscale identity authentication is **not** a configured `GatewayAuthMode`. It is a
secondary, implicit pathway that activates under specific conditions.

**Activation criteria (all must be true):**

1. `tailscale.mode` is set to `"serve"`.
2. The configured auth mode is **not** `"password"` or `"trusted-proxy"`.

**Surface restriction:** Tailscale identity auth applies **only** to the
`ws-control-ui` surface (the WebSocket used by the control panel UI). HTTP API
endpoints still require token or password authentication even when Tailscale identity
is active.

**Verification chain:**

1. Read the `Tailscale-User-Login` header from the incoming request.
2. Verify the request arrived through the Tailscale proxy by confirming it originated
   from a loopback address and carries the expected forwarded headers.
3. Call `tailscale whois` to independently verify the source connection, obtaining the
   Tailscale identity from the local daemon.
4. Compare the `whois`-returned login against the header value (case-insensitive).

This multi-step verification prevents header spoofing: even if an attacker injects a
`Tailscale-User-Login` header, the `tailscale whois` call validates the actual
network-level identity.

**Tailscale serve/funnel constraints:**

| Constraint | Reason |
|---|---|
| Tailscale Funnel requires password mode | Funnel strips identity headers; only password auth is viable. |
| Tailscale serve/funnel requires loopback bind | The gateway must bind to loopback so the Tailscale daemon can proxy to it. |

### 1.3 Fail-Closed Behavior

The gateway enforces several invariants at startup. Violating any of them causes the
process to exit with an error rather than starting in an insecure state.

| Condition | Result |
|---|---|
| No auth mode can be resolved and no Tailscale alternate path | Gateway refuses to start (throws error). |
| Non-loopback bind address without shared secret or trusted-proxy | Gateway refuses to start. |
| Tailscale Funnel enabled but auth mode is not `"password"` | Gateway refuses to start. |
| Tailscale serve/funnel enabled but bind address is not loopback | Gateway refuses to start. |
| Trusted-proxy mode with empty `trustedProxies` list | Gateway refuses to start. |

### 1.4 Credential Resolution Chain

Credentials (tokens and passwords) are resolved through a layered chain. The chain
differs depending on whether the gateway is running in local or remote mode.

**Local mode** (default, `config-first` strategy):

```
config gateway.auth.token  →  env OPENCLAW_GATEWAY_TOKEN  →  (auto-generate)
```

**Remote mode:**

```
gateway.remote.token  →  env OPENCLAW_GATEWAY_TOKEN  →  local config (configurable fallback)
```

**Legacy environment variables:** The env var `CLAWDBOT_GATEWAY_TOKEN` is recognized
**only for client-side credential resolution** (i.e., when connecting to a remote
gateway). The gateway's own startup auth sets `includeLegacyEnv: false`, so
`CLAWDBOT_GATEWAY_TOKEN` is **not** used when the gateway resolves its own auth
credentials. It is checked after the primary env var only in the client/remote
credential resolution path.

### 1.5 Auth Mode Resolution Priority

When the gateway starts, it walks the following chain to determine the active auth
mode. The first match wins.

| Priority | Source | Example |
|---|---|---|
| 1 | `authOverride.mode` | CLI flags like `--auth-mode token` |
| 2 | `authConfig.mode` | Explicit `gateway.auth.mode` in config file |
| 3 | Implicit password mode | A password credential exists (config or env) but no explicit mode |
| 4 | Implicit token mode | A token credential exists (config or env) but no explicit mode |
| 5 | Default: token mode | No token is present, so auto-generation kicks in. If auto-generation is not possible and no Tailscale path exists, fail-closed. |

### 1.6 Device Identity and Pairing

Each device (CLI client, control UI instance) establishes a persistent cryptographic
identity used for fine-grained access control beyond the initial shared-secret
authentication.

#### Keypair

- **Algorithm:** Ed25519.
- **Storage:** `~/.openclaw/identity/device.json`, file mode `0o600` (owner read/write only).
- **DeviceId:** SHA-256 hash of the raw 32-byte public key, hex-encoded.

#### Challenge-Response Protocol

1. On WebSocket connection open, the server sends a random nonce to the client.
2. The client signs the following message and returns the signature:

```
v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes>|<signedAtMs>|<token>|<nonce>
```

3. The server verifies the Ed25519 signature against the device's registered public
   key.
4. **Timestamp skew check:** The `signedAtMs` value must be within **+/- 2 minutes**
   of the server's clock. This prevents replay of captured challenge-response
   exchanges.

#### Auto-Approval

Local connections (originating from a loopback address on the same host, or from the
same Tailscale node) are **auto-approved** without manual pairing.

#### Device Tokens

| Property | Value |
|---|---|
| Size | 32 bytes random |
| Encoding | base64url |
| Scoping | Bound to a specific `role` and `scopes` set |

**Token lifecycle:**

```
Issuance  →  Rotation (preserves createdAtMs, replaces token value)  →  Revocation (sets revokedAtMs)
```

- Rotated tokens retain the original `createdAtMs` timestamp, allowing audit trails
  to track the total lifetime of a device's access grant.
- Revoked tokens have `revokedAtMs` set. The verification function rejects any token
  with a non-null `revokedAtMs`.

#### Pairing Flow

- Pending pairing requests **expire after 5 minutes**.
- A connection without a completed device identity handshake has **all scopes
  stripped** (default-deny).

### 1.7 Scope Enforcement

Every method exposed by the gateway is classified into a scope. A device token grants
a role, and each role implies a set of scopes.

**Role-to-scope mapping:**

| Role | Implied scopes |
|---|---|
| `admin` | `read`, `write`, `approvals`, `pairing` |
| `write` | `read` (write implies read) |
| `read` | (no further implications) |
| `approvals` | (standalone) |
| `pairing` | (standalone) |

**Scope-to-method classification:**

| Scope | Methods |
|---|---|
| `operator.admin` | Channel logout, agent CRUD, cron management, session management |
| `operator.write` | Send message, agent invocation, chat, browser automation, node invoke |
| `operator.read` | Health check, status, logs, listings, config read |
| `operator.approvals` | Exec approval flow (approve/deny pending tool executions) |
| `operator.pairing` | Device pairing, node pairing |

Connections without a verified device identity have **all scopes stripped**. This
means even if a connection passes shared-secret auth, it cannot invoke any
scope-guarded method until device identity is established. This is the default-deny
posture.

### 1.8 Rate Limiting

Rate limiting protects authentication endpoints against brute-force attacks. The
implementation uses an **in-memory sliding window** keyed by `{scope, clientIp}`.

**Scopes and defaults:**

| Scope | Max attempts | Window | Lockout | Notes |
|---|---|---|---|---|
| `shared-secret` | 10 | 60s | 300s | Main gateway auth (token/password) |
| `device-token` | 10 | 60s | 300s | Device token verification |
| `hook-auth` | 20 | 60s | 60s | Webhook endpoint auth; always-on, separate limiter |

**Configuration:**

```yaml
gateway:
  auth:
    rateLimit:
      maxAttempts: 10
      windowMs: 60000
      lockoutMs: 300000
      exemptLoopback: true
```

**Loopback exemption:** By default (`exemptLoopback: true`), requests from loopback
addresses (`127.0.0.1`, `::1`) are exempt from rate limiting. **Exception:** hook auth
is **never** exempt from loopback rate limiting, regardless of this setting.

**Activation:** Rate limiting for the main auth flow is only active when
`gateway.auth.rateLimit` is explicitly configured. It is **not enabled by default**.
The hook endpoint has its own always-on rate limiter that does not depend on this
configuration.

---

## Part 2: Channel Access Control

Channel access control determines which inbound messages (DMs, group messages) are
processed by the bot and which are silently dropped or met with a pairing challenge.
This layer operates independently of gateway authentication; it governs who can talk
to the bot through messaging channels (Signal, Telegram, WhatsApp, etc.), not who can
connect to the gateway.

### 2.1 DM Policies

Each channel has a `dmPolicy` setting that controls how direct messages from unknown
senders are handled.

| Policy | Behavior | Default |
|---|---|---|
| `pairing` | Unknown senders receive a pairing code. Bot ignores messages until the code is approved. | Yes (this is the default) |
| `allowlist` | Only senders present in the allowlist may DM the bot. No pairing flow. | |
| `open` | All senders accepted. Requires `"*"` in the allowlist as an explicit opt-in. | |
| `disabled` | All DMs are blocked unconditionally. | |

#### Pairing Codes

When `dmPolicy` is `pairing`, unknown senders trigger the pairing flow:

| Property | Value |
|---|---|
| Code length | 8 characters |
| Character set | Alphanumeric, excluding ambiguous characters: `O`, `0`, `I`, `1` |
| Expiry | 1 hour |
| Max pending per channel | 3 |

The operator sees the pending pairing request in the control UI and can approve or
reject it. Once approved, the sender is added to the persistent allowlist.

#### Allowlist Merge

The effective allowlist for a channel is the **union** of two sources:

1. **Config-based:** Entries in `channels.<provider>.allowFrom` in the config file.
2. **Store-based:** Entries persisted at `~/.openclaw/credentials/<channel>-allowFrom.json`
   (added through the pairing flow or API).

**Important exception:** When `dmPolicy` is `allowlist`, store-based entries are
**excluded** from the merge. Only config-based entries are honored. This prevents the
pairing flow (which writes to the store) from circumventing a deliberately restrictive
allowlist policy.

#### Audit Behavior

Setting `dmPolicy` to `open` causes the audit system to flag the configuration as
**critical**. This is intentional: open DM policies expose the bot to arbitrary
senders, and the audit trail ensures operators are aware of this posture.

**Configuration example:**

```yaml
channels:
  signal:
    dmPolicy: "pairing"
    allowFrom:
      - "+15551234567"
      - "+15559876543"
  telegram:
    dmPolicy: "allowlist"
    allowFrom:
      - "alice_username"
```

### 2.2 Group Policies

Group message handling is controlled by a separate policy that governs which members
of a group chat may interact with the bot.

| Policy | Behavior | Default |
|---|---|---|
| `disabled` | All group messages blocked. | |
| `allowlist` | Only senders in `effectiveGroupAllowFrom` may interact. | Yes (this is the default) |
| `open` | All group members may interact. Audit flags as critical. | |

**`requireMention` (per-group boolean):**

In addition to the group policy, each group's configuration has an optional
`requireMention?: boolean` property. When `true`, the bot must be @mentioned for
the message to be processed, unless an authorized command bypasses the mention
requirement. This setting is independent of the group policy and can be combined
with any of the three policies above.

**Key rule:** Replying to a bot message (implicit mention) does **not** bypass sender
allowlists. Even if a disallowed sender replies directly to the bot's message, the
reply is dropped if the sender is not in the allowlist.

#### Per-Sender Tool Policies in Groups

Within groups, tool access can be restricted on a per-sender basis using the
`toolsBySender` configuration. Sender keys use typed prefixes to match against
different identifier formats:

| Key format | Matches on |
|---|---|
| `id:<id>` | Platform-specific user ID |
| `e164:<phone>` | Phone number in E.164 format |
| `username:<handle>` | Platform username/handle |
| `name:<name>` | Display name |
| `*` | Wildcard; matches all senders |

**Configuration example:**

```yaml
channels:
  signal:
    groups:
      "my-team-group":
        groupPolicy: "allowlist"
        groupAllowFrom:
          - "+15551234567"
          - "+15559876543"
        toolsBySender:
          "e164:+15551234567":
            allow: ["*"]
          "e164:+15559876543":
            allow: ["web-search", "read-file"]
            deny: ["shell-exec"]
          "*":
            allow: ["web-search"]
```

### 2.3 Session Isolation

The `session.dmScope` setting controls how DM conversations are routed to backend
sessions. This has direct security implications: shared sessions can leak context
between users.

| Scope | Behavior | Risk |
|---|---|---|
| `main` | All DMs share a single session. | **Context leakage** if multiple users DM the bot. One user sees conversation history and tool outputs from another. This is the default for backward compatibility. |
| `per-peer` | Each unique sender gets a single session across all channels. Session key: `agent:<agentId>:direct:<peerId>`. | Useful when a user should have one continuous conversation regardless of channel, but different users must be isolated. |
| `per-channel-peer` | Each unique `(channel, sender)` pair gets its own isolated session. | Recommended for multi-user deployments. |
| `per-account-channel-peer` | Each unique `(account, channel, sender)` triple gets its own session. | Required when running multiple bot accounts on the same channel provider. |

**Configuration example:**

```yaml
session:
  dmScope: "per-channel-peer"
```

#### Identity Links

`session.identityLinks` allows collapsing sessions for the same person across
different channels. For example, if Alice messages the bot on both Signal and
Telegram, identity links can route both conversations to the same session.

```yaml
session:
  dmScope: "per-channel-peer"
  identityLinks:
    alice:
      - "+15551234567"
      - "alice_username"
    bob:
      - "+15559876543"
      - "bob_tg"
```

The `identityLinks` field is a flat record (map) where each key is a canonical name
and the value is an array of identifier strings. This maps to the Zod schema
`z.record(z.string(), z.array(z.string()))`.

This merges the sessions so Alice has a continuous conversation regardless of which
channel she uses. Without identity links, she would have two independent sessions.

### 2.4 Command Authorization

Commands (e.g., `/exec`, `/status`) have their own authorization layer that
intersects with channel access control.

#### Access Group Requirement

```yaml
commands:
  useAccessGroups: true  # default
```

When `useAccessGroups` is `true` (the default), a sender must be present in **at
least one allowlist** (DM allowlist or group allowlist) to execute any command. This
prevents scenarios where a sender who cannot chat with the bot could still issue
commands.

When `useAccessGroups` is `false`, the `modeWhenAccessGroupsOff` setting controls the
fallback behavior:

| Mode | Behavior |
|---|---|
| `allow` | All senders can execute commands. |
| `deny` | No senders can execute commands. |
| `configured` | Command authorization falls back to per-command configuration. |

#### The `/exec` Command

The `/exec` command adjusts session defaults (e.g., working directory, environment
variables) for authorized senders. It does **not** grant tool access. A sender who is
authorized to use `/exec` but whose tool policy denies `shell-exec` will still be
unable to execute shell commands through the bot.

---

## Summary: Defense in Depth

The two layers described in this document form concentric security boundaries:

```
                    +-----------------------------------------+
                    |  Channel Access Control (Part 2)        |
                    |  - DM policies (pairing/allowlist/open) |
                    |  - Group policies                       |
                    |  - Per-sender tool policies             |
                    |  - Session isolation                    |
                    |  - Command authorization                |
                    |                                         |
                    |    +-------------------------------+    |
                    |    |  Gateway Authentication (1)   |    |
                    |    |  - Auth mode (token/pass/     |    |
                    |    |    proxy/none)                 |    |
                    |    |  - Tailscale identity          |    |
                    |    |  - Device identity & pairing   |    |
                    |    |  - Scope enforcement           |    |
                    |    |  - Rate limiting               |    |
                    |    +-------------------------------+    |
                    |                                         |
                    +-----------------------------------------+
```

**Gateway authentication** controls who can connect to and operate the gateway
(operators, CLI tools, the control UI). **Channel access control** controls who can
talk to the bot through messaging platforms (end users, team members). A compromised
gateway credential does not bypass channel allowlists, and an allowlisted channel
sender does not gain gateway operator access. The two domains are orthogonal by
design.
