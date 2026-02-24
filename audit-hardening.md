# Audit & Hardening

## 1. Security Audit CLI

```bash
openclaw security audit          # Basic scan
openclaw security audit --deep   # + live gateway probe + plugin/skill code scanning
openclaw security audit --fix    # Auto-fix footguns
openclaw security audit --json   # Machine-readable output
```

## 2. What the Audit Checks

27 collector functions organized by category:

| Category | Checks |
|----------|--------|
| Overview | Attack surface summary |
| Storage | Synced folder detection (iCloud, Dropbox, Google Drive, OneDrive) |
| Gateway | Bind mode, auth config, Tailscale, trusted proxies, rate limiting |
| Browser | CDP auth, remote HTTP exposure |
| Logging | Redaction settings |
| Elevated | Exec allowlists, wildcards |
| Exec | Sandbox misconfig (host=sandbox with sandbox off), interpreter safeBins |
| Hooks | Token length, token reuse, session key control, prefixes |
| HTTP API | No-auth endpoints, session key overrides |
| Sandbox | Docker noop, dangerous bind mounts |
| Nodes | Deny command patterns, dangerous allow commands |
| Config | Minimal profile overrides, plaintext secrets, dangerous flags |
| Models | Legacy/weak models, small parameter risk |
| Exposure | Combined exposure matrix (open groups + runtime/fs tools) |
| Filesystem | State dir/config permissions, symlinks |
| Plugins | Trust/provenance, code safety (deep only) |
| Skills | Code safety scanning (deep only) |
| Channels | DM/group policies per provider |

`--deep` adds: plugin code scanning, skill code scanning, live gateway probe (WebSocket connect + health check).

`--fix` applies: redaction on, open group policies to allowlist, file permissions (0o700/0o600).

## 3. All Security Audit checkId Values

### Gateway

| checkId | Severity | What it catches |
|---------|----------|-----------------|
| gateway.bind_no_auth | critical | Remote bind without shared secret |
| gateway.loopback_no_auth | critical | Reverse-proxied loopback unauthenticated |
| gateway.http.no_auth | warn/critical | HTTP APIs with auth.mode="none" |
| gateway.tools_invoke_http.dangerous_allow | warn/critical | Re-enabled dangerous tools over HTTP |
| gateway.nodes.allow_commands_dangerous | warn/critical | High-impact node commands enabled |
| gateway.tailscale_funnel | critical | Public internet exposure |
| gateway.control_ui.insecure_auth | warn | Insecure-auth compat toggle |
| gateway.control_ui.device_auth_disabled | critical | Device identity check disabled |
| gateway.real_ip_fallback_enabled | warn/critical | X-Real-IP spoofing risk |
| gateway.token_too_short | warn | Gateway token too short |
| gateway.trusted_proxies_missing | warn | No trusted proxies configured |
| gateway.trusted_proxy_no_proxies | critical | Trusted-proxy mode without proxies |
| gateway.trusted_proxy_no_user_header | critical | No user header configured |
| gateway.trusted_proxy_no_allowlist | warn | No user allowlist |
| gateway.auth_no_rate_limit | warn | No auth rate limiting configured |
| gateway.tailscale_serve | info | Tailscale Serve exposure |
| gateway.trusted_proxy_auth | critical | Trusted-proxy auth misconfiguration |
| gateway.http.session_key_override_enabled | info | HTTP session key override enabled |
| gateway.probe_failed | warn | Live probe failed (--deep) |

### Discovery

| checkId | Severity |
|---------|----------|
| discovery.mdns_full_mode | warn/critical |

### Filesystem

| checkId | Severity | Auto-fix |
|---------|----------|----------|
| fs.state_dir.perms_world_writable | critical | yes |
| fs.state_dir.perms_group_writable | warn | yes |
| fs.state_dir.perms_readable | warn | yes |
| fs.state_dir.symlink | warn | no |
| fs.config.perms_writable | critical | yes |
| fs.config.perms_world_readable | critical | yes |
| fs.config.perms_group_readable | warn | yes |
| fs.config.symlink | warn | no |
| fs.synced_dir | warn | no |
| fs.config_include.perms_writable | critical | yes |
| fs.config_include.perms_world_readable | critical | yes |
| fs.config_include.perms_group_readable | warn | yes |
| fs.credentials_dir.perms_writable | critical | yes |
| fs.credentials_dir.perms_readable | warn | yes |
| fs.auth_profiles.perms_writable | critical | yes |
| fs.auth_profiles.perms_readable | warn | yes |
| fs.sessions_store.perms_readable | warn | yes |
| fs.log_file.perms_readable | warn | yes |

### Browser

| checkId | Severity |
|---------|----------|
| browser.control_invalid_config | warn |
| browser.control_no_auth | critical |
| browser.remote_cdp_http | warn |

### Logging

| checkId | Severity | Auto-fix |
|---------|----------|----------|
| logging.redact_off | warn | yes |

### Hooks

| checkId | Severity |
|---------|----------|
| hooks.token_too_short | warn |
| hooks.token_reuse_gateway_token | critical |
| hooks.path_root | critical |
| hooks.default_session_key_unset | warn |
| hooks.request_session_key_enabled | warn/critical |
| hooks.request_session_key_prefixes_missing | warn/critical |

### Config

| checkId | Severity |
|---------|----------|
| config.insecure_or_dangerous_flags | warn |
| config.secrets.gateway_password_in_config | warn |
| config.secrets.hooks_token_in_config | info |

### Tools/Exec

| checkId | Severity |
|---------|----------|
| tools.exec.host_sandbox_no_sandbox_defaults | warn |
| tools.exec.host_sandbox_no_sandbox_agents | warn |
| tools.exec.safe_bins_interpreter_unprofiled | warn |
| tools.elevated.allowFrom.*.wildcard | critical |
| tools.elevated.allowFrom.*.large | warn |

### Sandbox

| checkId | Severity |
|---------|----------|
| sandbox.docker_config_mode_off | warn |
| sandbox.dangerous_bind_mount | critical |
| sandbox.bind_mount_non_absolute | warn |
| sandbox.dangerous_network_mode | critical |
| sandbox.dangerous_seccomp_profile | critical |
| sandbox.dangerous_apparmor_profile | critical |
| sandbox.browser_cdp_bridge_unrestricted | warn |
| sandbox.browser_container.hash_label_missing | warn |
| sandbox.browser_container.hash_epoch_stale | warn |
| sandbox.browser_container.non_loopback_publish | critical |
| tools.profile_minimal_overridden | warn |
| plugins.tools_reachable_permissive_policy | warn |

### Exposure

| checkId | Severity |
|---------|----------|
| security.exposure.open_groups_with_runtime_or_fs | critical/warn |
| models.small_params | critical/info |

### Channels (per provider)

| checkId | Severity |
|---------|----------|
| channels.*.dm.open | critical |
| channels.*.dm.open_invalid | warn |
| channels.*.dm.disabled | info |
| channels.*.dm.scope_main_multiuser | warn |
| channels.discord.allowFrom.name_based_entries | warn |
| channels.discord.commands.native.unrestricted | critical |
| channels.discord.commands.native.no_allowlists | warn |
| channels.slack.commands.slash.useAccessGroups_off | critical |
| channels.slack.commands.slash.no_allowlists | warn |
| channels.telegram.allowFrom.invalid_entries | warn |
| channels.telegram.groups.allowFrom.wildcard | critical |
| channels.telegram.groups.allowFrom.missing | critical |

### Plugins

| checkId | Severity |
|---------|----------|
| plugins.extensions_no_allowlist | warn/critical |
| plugins.installs_unpinned_npm_specs | warn |
| plugins.installs_missing_integrity | warn |
| plugins.installs_version_drift | warn |
| plugins.code_safety | critical/warn |
| plugins.code_safety.scan_failed | warn |
| plugins.code_safety.entry_path | warn |
| plugins.code_safety.entry_escape | critical |

### Skills

| checkId | Severity |
|---------|----------|
| skills.code_safety | critical/warn |
| skills.code_safety.scan_failed | warn |

### Other

| checkId | Severity |
|---------|----------|
| security.exposure.open_groups_with_elevated | critical |
| models.legacy | warn |
| models.weak_tier | warn |
| gateway.nodes.deny_commands_ineffective | warn |
| hooks.installs_unpinned_npm_specs | warn |
| hooks.installs_missing_integrity | warn |
| hooks.installs_version_drift | warn |
| summary.attack_surface | info |

## 4. Dangerous Config Flags

The audit aggregates `config.insecure_or_dangerous_flags` when any of these are enabled:

- `gateway.controlUi.allowInsecureAuth=true`
- `gateway.controlUi.dangerouslyDisableDeviceAuth=true`
- `hooks.gmail.allowUnsafeExternalContent=true`
- `hooks.mappings[N].allowUnsafeExternalContent=true`
- `tools.exec.applyPatch.workspaceOnly=false`

## 5. Hardening Checklist (Priority Order)

1. **Lock down inbound access**: DM pairing/allowlists, group requireMention, session isolation (per-channel-peer)
2. **Network exposure**: loopback bind, Tailscale Serve (not Funnel), gateway auth token, mDNS minimal/off
3. **Tool policy**: messaging profile for untrusted, deny group:automation + group:runtime + group:fs for public agents
4. **Sandboxing**: mode=all or mode=non-main, scope=session, workspaceAccess=none
5. **Exec security**: security=deny or security=allowlist, ask=always
6. **Elevated**: disabled unless needed, tight allowFrom per provider
7. **File permissions**: 700 on dirs, 600 on files (run `openclaw security audit --fix`)
8. **Hooks**: long token (>=24 chars), different from gateway token, allowRequestSessionKey=false
9. **Plugins**: explicit plugins.allow, review before enabling
10. **Browser**: dedicated profile, disable sync/password managers, tailnet-only for remote
11. **Logging**: redactSensitive="tools", add custom redactPatterns for your environment
12. **Model choice**: latest instruction-hardened model (Opus 4.6), avoid small models for tool-enabled agents

## 6. Secure Baseline Config (Complete)

```json5
{
  gateway: {
    mode: "local",
    bind: "loopback",
    port: 18789,
    auth: { mode: "token", token: "your-long-random-token-here" },
  },
  discovery: {
    mdns: { mode: "minimal" },
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
  logging: {
    redactSensitive: "tools",
  },
  channels: {
    whatsapp: {
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } },
    },
    telegram: {
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } },
    },
    discord: {
      dmPolicy: "pairing",
    },
  },
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",
        scope: "session",
        workspaceAccess: "none",
      },
    },
  },
}
```

## 7. Per-Agent Profiles

### Full access (personal, no sandbox)

```json5
{
  agents: {
    list: [{
      id: "personal",
      workspace: "~/.openclaw/workspace-personal",
      sandbox: { mode: "off" },
    }],
  },
}
```

### Read-only (family/work)

```json5
{
  agents: {
    list: [{
      id: "family",
      workspace: "~/.openclaw/workspace-family",
      sandbox: { mode: "all", scope: "agent", workspaceAccess: "ro" },
      tools: {
        allow: ["read"],
        deny: ["write", "edit", "apply_patch", "exec", "process", "browser"],
      },
    }],
  },
}
```

### No filesystem (public messaging)

```json5
{
  agents: {
    list: [{
      id: "public",
      sandbox: { mode: "all", scope: "agent", workspaceAccess: "none" },
      tools: {
        sessions: { visibility: "tree" },
        allow: ["sessions_list", "sessions_history", "session_status", "message"],
        deny: ["read", "write", "edit", "apply_patch", "exec", "process", "browser", "canvas", "nodes", "cron", "gateway", "image"],
      },
    }],
  },
}
```

## 8. Incident Response

### Contain

1. Stop gateway process
2. Set `gateway.bind: "loopback"`, disable Tailscale Funnel/Serve
3. Switch risky DMs/groups to disabled/require mentions

### Rotate

1. Gateway auth token/password, then restart
2. Remote client secrets
3. Provider/API credentials

### Audit

1. Check logs: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
2. Review transcripts: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
3. Review recent config changes
4. Re-run `openclaw security audit --deep`

### Collect for Report

- Timestamp, OS, OpenClaw version
- Session transcript(s) + log tail (after redacting)
- What attacker sent + what agent did
- Whether gateway was exposed beyond loopback
