# OpenClaw Security Documentation

## What is OpenClaw

OpenClaw is a self-hosted AI agent gateway. It connects frontier LLMs to messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Microsoft Teams), gives them tools (shell, filesystem, browser, web), and runs on your hardware. It builds on top of the Pi Coding Agent framework. Because it bridges untrusted message sources to powerful local capabilities, security configuration is not optional -- it is the core concern.

---

## The Trust Model

OpenClaw assumes the **host and config boundary are trusted**. If someone can modify `~/.openclaw` or `openclaw.json`, they are a trusted operator. Running one Gateway for multiple mutually untrusted operators is **NOT** supported. For mixed-trust teams, use separate gateways or separate OS users/hosts.

The security philosophy: **Access control before intelligence.**

Most failures are not fancy exploits -- they are "someone messaged the bot and the bot did what they asked." The priority order is:

| Priority | Principle | Rationale |
|----------|-----------|-----------|
| 1 | **Identity first** | Decide who can talk to the bot. |
| 2 | **Scope next** | Decide where the bot can act. |
| 3 | **Model last** | Assume the model can be manipulated; limit blast radius. |

If identity gating is wrong, no amount of prompt engineering saves you. If scope is wide open, a jailbreak becomes an RCE. Treat the model as an untrusted interpreter running inside your policy boundary.

---

## Trust Boundary Matrix

Not everything that looks like a security boundary is one. This table clarifies what each boundary actually controls and what it does **not** control.

| Boundary | What it controls | What it does NOT control |
|----------|-----------------|--------------------------|
| `gateway.auth` | Authenticates callers to gateway APIs. | NOT per-message signatures. A valid gateway token authorizes all messages sent through that connection. |
| `sessionKey` | Routing key for conversation context. Determines which messages share state. | NOT a user auth boundary. Session isolation is for context separation, not access control. |
| Prompt / content guardrails | Reduce model abuse risk. Useful as defense-in-depth. | NOT guaranteed prevention. Guardrails are probabilistic, not deterministic. |
| `canvas.eval` / `browser.evaluate` | Intentional operator capability for running code in browser contexts. | NOT automatically a vulnerability. The operator chose to enable this. |
| Local TUI `!` shell | Explicit operator-triggered execution from the terminal interface. | NOT remote injection. Requires physical/terminal access to the running TUI. |
| Node pairing and commands | Operator-level remote execution between paired OpenClaw nodes. | NOT untrusted user access. Pairing requires explicit operator approval. |

---

## Security Surface Map

Every security domain, what it covers, and where to find the details.

| Domain | Page | What it covers |
|--------|------|----------------|
| Gateway Authentication | [access-control.md](access-control.md) | Token, password, trusted-proxy, Tailscale, device identity, pairing, rate limiting |
| Channel Access Control | [access-control.md](access-control.md) | DM policies, group policies, allowlists, pairing codes, session isolation |
| Tool Policy | [tool-security.md](tool-security.md) | Profiles, allow/deny, exec approvals, safeBins |
| Sandboxing | [tool-security.md](tool-security.md) | Docker isolation, modes, scope, workspace access, browser sandbox |
| Elevated Mode | [tool-security.md](tool-security.md) | Host escape hatch, allowFrom gates |
| Network Exposure | [network-security.md](network-security.md) | Bind modes, TLS, reverse proxy, mDNS, HSTS |
| Hooks | [network-security.md](network-security.md) | Hook endpoint auth, session key control, unsafe content flags |
| Plugins & Extensions | [plugins-extensions.md](plugins-extensions.md) | Plugin loading, allowlists, HTTP routes, npm risks |
| Pi Agent Framework | [pi-agent-security.md](pi-agent-security.md) | Extension hooks, tool blocking, in-process trust model |
| Credentials & Secrets | [credentials-secrets.md](credentials-secrets.md) | Storage locations, file permissions, redaction, rotation |
| Agent Configuration | [agent-configuration.md](agent-configuration.md) | System prompts, SOUL.md, SKILL.md, bootstrap files, plugin hooks, sanitization |
| Audit & Hardening | [audit-hardening.md](audit-hardening.md) | Security audit CLI, all checkIds, detect-secrets |
| **Goto Spec** | [goto-spec.md](goto-spec.md) | **Enterprise hardening baseline, OSCAL-inspired control schema, validation** |

---

## What is NOT a Vulnerability (by Design)

The following classes of findings are **out of scope** and will not be treated as vulnerabilities:

- **Prompt-injection-only chains** that do not bypass a policy, auth, or sandbox boundary. If the model misbehaves but stays inside its allowed tool set and permissions, that is a guardrail tuning issue, not a security vulnerability.
- **Claims assuming hostile multi-tenant on one shared host/config.** The trust model explicitly excludes this. Separate untrusted operators require separate gateways or separate OS users/hosts.
- **Localhost-only findings** (e.g., missing HSTS on loopback). When `bind` is `loopback`, the network listener is not reachable from other machines.
- **Discord inbound webhook signature findings** for paths that do not exist in the application.
- **"Missing per-user authorization"** reports that treat `sessionKey` as an auth boundary. It is a routing key, not an access control mechanism. See the Trust Boundary Matrix above.

---

## Quick Start: Hardened Baseline

Copy this into your `openclaw.json` for a locked-down starting point. Relax permissions deliberately from here.

```json5
{
  gateway: {
    mode: "local",
    bind: "loopback",
    auth: { mode: "token", token: "replace-with-long-random-token" },
  },
  session: {
    dmScope: "per-channel-peer",
  },
  tools: {
    profile: "messaging",
    deny: ["group:automation", "group:runtime", "group:fs", "sessions_spawn", "sessions_send"],
    fs: { workspaceOnly: true },
    exec: { security: "deny", ask: "always" },
    elevated: { enabled: false },
  },
  channels: {
    whatsapp: { dmPolicy: "pairing", groups: { "*": { requireMention: true } } },
  },
}
```

What this does:

| Setting | Effect |
|---------|--------|
| `mode: "local"` | No external network listener. |
| `bind: "loopback"` | Only localhost connections accepted. |
| `auth.mode: "token"` | All API calls require a bearer token. |
| `dmScope: "per-channel-peer"` | Each contact gets an isolated session. No cross-conversation context leakage. |
| `profile: "messaging"` | Restricted tool set designed for messaging use cases. |
| `deny: [...]` | Explicitly blocks automation, runtime, filesystem, and session-spawning tools. |
| `fs.workspaceOnly: true` | Filesystem tools cannot escape the workspace directory. |
| `exec.security: "deny"` | Shell execution denied by default. |
| `exec.ask: "always"` | If exec is ever enabled, require approval every time. |
| `elevated.enabled: false` | No host escape hatch. The sandbox is the ceiling. |
| `dmPolicy: "pairing"` | New WhatsApp contacts must complete a pairing flow before the bot responds. |
| `requireMention: true` | In groups, the bot only responds when explicitly mentioned. |

---

## Pi Coding Agent: The Foundation

OpenClaw builds on the **Pi Coding Agent** framework. Pi's security model is fundamentally different from OpenClaw's -- it assumes a **trust-the-user model**:

- **No built-in sandboxing.** Pi executes tools directly on the host.
- **No default tool approval.** All tools are available unless the extension blocks them.
- **No extension code verification.** Extensions run in-process with full Node.js access.

OpenClaw adds all the security layers on top: sandboxing, exec approvals, tool allowlists, channel access control, gateway authentication, and more. Pi provides the extension hooks that OpenClaw uses to implement security policy:

| Hook | OpenClaw usage |
|------|---------------|
| `tool_call` blocking | Enforce tool deny lists and exec approval gates before execution. |
| `tool_result` modification | Redact secrets and sensitive content from model-visible output. |
| `context` manipulation | Inject system prompts with security constraints and session policy. |

These hooks run in-process. A malicious or buggy extension has the same privileges as the OpenClaw process itself. Extension trust is operator trust.

For full details on Pi's security model and how OpenClaw layers on top of it, see [pi-agent-security.md](pi-agent-security.md).

---

## Reporting Security Issues

If you find a security vulnerability in OpenClaw:

- **Email:** [security@openclaw.ai](mailto:security@openclaw.ai)
- **Do not** post details publicly until the issue is fixed and a patch is released.
- **Before reporting**, review the SECURITY.md researcher preflight checklist to confirm your finding is in scope. The "What is NOT a Vulnerability" section above covers the most common out-of-scope reports.

Include in your report: affected version, reproduction steps, and the specific policy/auth/sandbox boundary that is bypassed.
