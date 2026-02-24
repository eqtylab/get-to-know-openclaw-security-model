# Network Security

This document covers OpenClaw's network exposure surface: binding modes, TLS configuration, reverse proxy integration, mDNS discovery, HTTP endpoint authentication, hooks security, and WebSocket security.

---

## 1. Network Binding

OpenClaw's gateway binds to a single address determined by the configured bind mode. The mode controls which network interfaces accept inbound connections.

### Bind Modes

| Mode | Bind Address | Fallback |
|------|-------------|----------|
| `loopback` (default) | `127.0.0.1` | `0.0.0.0` (extreme fallback only) |
| `lan` | `0.0.0.0` | None |
| `tailnet` | Tailscale IPv4 (`100.64.0.0/10`) | `127.0.0.1`, then `0.0.0.0` |
| `auto` | `127.0.0.1` if bindable | `0.0.0.0` |
| `custom` | User-specified IP | `0.0.0.0` |

### Strict Validation

- `loopback` mode resolving to a non-loopback address throws a startup error.
- `custom` mode resolving to an address different from what the user specified throws a startup error.
- Dual-stack behavior: binding `127.0.0.1` also attempts `::1`.

### Gateway Port

The default gateway port is **18789** (configurable). A single port multiplexes all traffic:

- WebSocket connections
- HTTP API endpoints
- Control UI static assets
- Canvas host

### Canvas Host

Canvas is served at two paths:

```
/__openclaw__/canvas/
/__openclaw__/a2ui/
```

Canvas authentication accepts any one of:

1. **Local direct** connection (loopback)
2. **Bearer token** (gateway token)
3. **Canvas capability token** -- 18 random bytes, base64url-encoded, with a sliding 10-minute TTL, scoped to the connection

---

## 2. TLS

### Gateway TLS Configuration

- Enforces **TLS 1.3 minimum**.
- Auto-generates self-signed certificates: **RSA-2048**, **SHA-256** signature, **10-year** validity.
- Key files written with mode `0o600`.
- Certificate fingerprint is broadcast via mDNS for cert pinning (see Section 4).
- Optional CA path for **mTLS** (mutual TLS).

### Certificate Pinning

Remote connections support explicit cert pinning via:

```
gateway.remote.tlsFingerprint
```

### Security Headers

HSTS is **NOT** automatic, even when TLS is enabled. It must be explicitly configured:

```
gateway.http.securityHeaders.strictTransportSecurity
```

Default headers applied:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

The following headers are intentionally **absent from base/default headers** (to allow canvas/A2UI framing):

- `X-Frame-Options`
- `Content-Security-Policy`

However, the **Control UI** specifically sets both of these via `applyControlUiSecurityHeaders()`: `X-Frame-Options: DENY` and a full `Content-Security-Policy` header. The absence only applies to the base security headers applied to all other responses.

---

## 3. Reverse Proxy

### Trusted Proxy Configuration

```
gateway.trustedProxies
```

Accepts an array of proxy IPs (supports CIDR notation).

### Client IP Resolution (X-Forwarded-For)

The `X-Forwarded-For` header is walked **right-to-left**. The first IP **not** present in the `trustedProxies` list is returned as the client IP. This is the correct anti-spoofing algorithm.

### X-Real-IP Fallback

`X-Real-IP` is used as a fallback **only** when all three conditions are met:

1. The remote address IS a trusted proxy.
2. `X-Forwarded-For` walking yielded no untrusted IP.
3. `allowRealIpFallback: true` is set (default: **false**).

### Fail-Closed Behavior

- Traffic arriving from a trusted proxy **without** client identification headers results in an undefined client IP. It is **not** treated as a local connection.
- Proxy headers present but the remote address is **not** a trusted proxy: the request is **not** treated as local. A warning is logged.

### Nginx Configuration

Good -- sends only the direct client IP:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Bad -- appends to an attacker-controllable chain:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### Trusted Proxy Auth Mode

Trusted proxy authentication requires:

- Remote address must be in `trustedProxies`.
- All `requiredHeaders` must be present.
- `userHeader` must be present.
- Optional `allowUsers` list restricts which user values are accepted.

Startup validation:

- `trustedProxies` must be non-empty.
- Loopback bind mode requires at least one loopback address in the proxy list.

---

## 4. mDNS / Bonjour Discovery

### Discovery Modes

| Mode | Behavior |
|------|----------|
| `off` | No broadcasting |
| `minimal` (default) | Broadcasts gateway port, TLS status, display name, and Tailnet DNS hint. Omits `cliPath` and `sshPort`. |
| `full` | Includes everything in `minimal` plus `cliPath` and `sshPort` (additional information disclosure risk). |

> **Note:** The Tailnet DNS hint (`tailnetDns` TXT record) is included in the shared `txtBase` and is therefore disclosed in **both** `minimal` and `full` modes. Only `cliPath` and `sshPort` are gated on full mode.

### Kill Switch

mDNS broadcasting can be unconditionally disabled via environment variable:

```bash
OPENCLAW_DISABLE_BONJOUR=1
```

### Wide-Area DNS-SD

Wide-area DNS-SD is a separate feature for unicast DNS-SD over Tailnet:

```
discovery.wideArea.enabled
```

This is independent of the local mDNS mode setting.

---

## 5. HTTP Endpoint Security

### Endpoint Authentication Matrix

| Endpoint | Auth Mechanism | Notes |
|----------|---------------|-------|
| Hooks (`/hooks/...`) | Separate bearer token (`hooks.token`) | Own rate limiter; query params blocked |
| Tools Invoke (`/tools/invoke`) | Gateway bearer token | Default deny list for dangerous tools |
| Slack HTTP (`/slack/...`) | Slack-specific verification | |
| Channel plugin routes (`/api/channels/...`) | Gateway bearer token | Auto-gated |
| Other plugin routes | **Plugin-owned auth** | **NOT** gateway-auth-protected |
| OpenResponses (`/v1/responses`) | Gateway bearer token | |
| OpenAI compat (`/v1/chat/completions`) | Gateway bearer token | |
| Canvas | Local direct OR bearer OR capability token | |
| Control UI | **No auth** (static assets) | Auth enforced at WebSocket level |

### Control UI Security

- **Origin check**: requests must match an explicit allowlist, or pass same-origin validation, or originate from loopback (loopback exemption).
- `allowInsecureAuth`: permits authentication without device identity, but **only** from localhost.
- `dangerouslyDisableDeviceAuth`: disables device identity verification entirely.

---

## 6. Hooks Security

### Authentication

Hook endpoints authenticate via bearer token, accepted in either header:

```
Authorization: Bearer <token>
X-OpenClaw-Token: <token>
```

Query parameters are **explicitly rejected** with HTTP 400.

Token comparison uses **timing-safe** comparison: SHA-256 hash of both values followed by `timingSafeEqual`.

### Rate Limiting

Hooks have their own dedicated rate limiter:

- **20 attempts per 60 seconds**.
- Does **NOT** exempt loopback connections.

### Token Constraints

- `hooks.token` has no hard minimum length enforced at config load.
- Audit warns when the token is fewer than **24 characters**.
- The token must not be empty.
- The hooks token **MUST** differ from the gateway token (enforced at startup).

### Session Key Controls

- `hooks.allowRequestSessionKey` (default: **false**): when false, external callers cannot supply a custom `sessionKey`. Hook mappings (operator-controlled) can always specify session keys regardless of this setting.
- `hooks.allowedSessionKeyPrefixes`: array of allowed prefixes (case-insensitive match). Both requested and generated keys must match at least one prefix. Validated at config load time.

### External Content Handling

`allowUnsafeExternalContent` (default: **false**)

When **false**, external content is wrapped with the following protections:

1. **Marker-spoofing sanitization** -- Unicode homoglyph detection and neutralization.
2. **Unique boundary markers** -- random 16-hex-character ID per content block.
3. **Security warning** -- injected into the wrapped content.
4. **Suspicious pattern detection** -- scans for known injection patterns.

When **true**, content is passed through directly. This is flagged as dangerous in configuration validation.

### Hook Template Security

Hook templates use `{{expression}}` interpolation with prototype pollution protection. The following property names are blocked in template expressions:

- `__proto__`
- `prototype`
- `constructor`

Transform modules are loaded from a contained directory with **symlink-escape protection** to prevent path traversal.

---

## 7. WebSocket Security

- Plain `ws://` (unencrypted WebSocket) is only considered secure for **loopback** connections (ref: [CWE-319](https://cwe.mitre.org/data/definitions/319.html) -- Cleartext Transmission of Sensitive Information).
- All WebSocket clients must include **device identity** in the connection handshake.
- Exception: Control UI connections when `dangerouslyDisableDeviceAuth` is enabled.
