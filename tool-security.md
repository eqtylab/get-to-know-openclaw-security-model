# Tool Security

This document is the comprehensive technical reference for OpenClaw's tool security model. It covers tool profiles, policy resolution, exec approvals, sandboxing, elevated mode, filesystem protections, and gateway restrictions.

---

## 1. Tool Profiles

Every session operates under one of four tool profiles, identified by `ToolProfileId`. The profile determines the baseline set of tools available before any further policy restrictions are applied.

| Profile | Tools Included |
|---------|----------------|
| **minimal** | `session_status` only |
| **coding** | `read`, `write`, `edit`, `apply_patch`, `exec`, `process`, `memory_search`, `memory_get`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `subagents`, `session_status`, `image` |
| **messaging** | `sessions_list`, `sessions_history`, `sessions_send`, `session_status`, `message` |
| **full** | No restrictions (empty policy = everything allowed) |

The `full` profile imposes no tool-level constraints at all. An empty policy object is treated as universal permission.

---

## 2. Tool Groups

Tools are organized into named groups for convenient reference in policy rules. A group name is prefixed with `group:` when used in allow/deny lists.

| Group | Tools |
|-------|-------|
| `group:fs` | `read`, `write`, `edit`, `apply_patch` |
| `group:runtime` | `exec`, `process` |
| `group:web` | `web_search`, `web_fetch` |
| `group:memory` | `memory_search`, `memory_get` |
| `group:sessions` | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `subagents`, `session_status` |
| `group:ui` | `browser`, `canvas` |
| `group:messaging` | `message` |
| `group:automation` | `cron`, `gateway` |
| `group:nodes` | `nodes` |
| `group:agents` | `agents_list` |
| `group:media` | `image`, `tts` |
| `group:openclaw` | All tools **except** `read`, `write`, `edit`, `apply_patch`, `exec`, `process` |
| `group:plugins` | Dynamically expanded at runtime to include all plugin-provided tools |

### Tool Name Aliases

Certain tool names are aliased for convenience:

| Alias | Canonical Name |
|-------|---------------|
| `bash` | `exec` |
| `apply-patch` | `apply_patch` |

Aliases are resolved before policy evaluation, so using either form in allow/deny lists has the same effect.

---

## 3. Policy Pipeline (Resolution Order)

Tool access is determined by walking through a layered policy pipeline. Each successive step can only **further restrict** access. **Deny always wins** -- if any layer denies a tool, it is denied regardless of what other layers allow.

The resolution order is:

1. **`tools.profile`** -- base profile (sets the initial tool set)
2. **`tools.byProvider.profile`** -- provider-specific profile override
3. **`tools.allow` / `tools.deny`** -- global allow/deny policy
4. **`tools.byProvider.allow` / `tools.byProvider.deny`** -- global provider-specific allow/deny
5. **`agents.<id>.tools.allow` / `agents.<id>.tools.deny`** -- per-agent allow/deny
6. **`agents.<id>.tools.byProvider.allow` / `agents.<id>.tools.byProvider.deny`** -- per-agent, per-provider allow/deny
7. **Group tools policy** -- channel/group-level restrictions

### Provider Tool Keys

The `byProvider` keys accept either a bare provider name or a `provider/model` string for model-specific restrictions:

```yaml
tools:
  byProvider:
    openai:
      profile: coding
    anthropic/claude-3-opus:
      deny:
        - exec
```

### Special Cases

- **Owner-only tools**: `whatsapp_login`, `cron`, and `gateway` are automatically removed from the tool set for non-owner senders.

- **Sub-agent restrictions**: The following tools are always denied for sub-agents: `gateway`, `agents_list`, `whatsapp_login`, `session_status`, `cron`, `memory_search`, `memory_get`, `sessions_send`. Leaf sub-agents (those that do not themselves spawn sub-agents) additionally lose all `sessions` tools.

- **Plugin-only allowlist stripping**: If an allow list contains **only** plugin tools, the entire allowlist is silently stripped (treated as if no allowlist were set). To additively enable plugin tools alongside default tools, use `tools.alsoAllow` instead of `tools.allow`.

- **Glob patterns**: Allow and deny lists support glob patterns for matching tool names:
  ```yaml
  tools:
    deny:
      - "sessions_*"
      - "web_*"
  ```

- **`apply_patch` implicit allowance**: If `apply_patch` is not in the allow list but `exec` is, `apply_patch` is implicitly allowed. This ensures that patching workflows remain functional when shell access is granted.

---

## 4. Exec Approval System

The exec approval system governs whether shell commands (via the `exec` tool) can run, and under what conditions the operator or user is prompted for permission.

### Security Modes

| Mode | Behavior |
|------|----------|
| `deny` | All exec calls are blocked unconditionally |
| `allowlist` | Commands must match an entry in the allowlist to run |
| `full` | All commands are permitted without restriction |

### Ask Modes

| Mode | Behavior |
|------|----------|
| `off` | Never prompt for approval |
| `on-miss` | Prompt only when a command does not match the allowlist |
| `always` | Prompt for every exec call, regardless of allowlist match |

### Mode Composition

- `minSecurity(a, b)` returns whichever mode is **more restrictive** (deny > allowlist > full).
- `maxAsk(a, b)` returns whichever mode is **more interactive** (always > on-miss > off).
- A tool-requested security level can never be weaker than the configured level. If the tool requests `full` but config says `allowlist`, the effective mode is `allowlist`.

### ExecApprovalManager

The `ExecApprovalManager` maintains an in-memory `Map` with Promise-based blocking for pending approvals.

- **Timeout**: 120 seconds by default. If no decision is received within this window, the request is denied.
- **Decisions**: `allow-once`, `allow-always`, `deny`.
- **Grace period**: 15 seconds after timeout for late-arriving decisions (prevents race conditions with slow messaging channels).
- **Forwarding**: Approval requests can be forwarded to messaging channels via `session`, `targets`, or `both` strategies.
- **Discord integration**: Discord channels support button-based approval UIs for interactive approval workflows.

### Allowlist Evaluation

Shell commands are parsed into **segments** (separated by pipes `|`, `&&`, `||`, `;`). Each segment is independently evaluated against:

1. Explicit allowlist entries
2. Safe bin rules (see section 5)
3. Skill bin rules

**All segments must pass** for the command to be approved. A single failing segment causes the entire pipeline to be rejected.

### Shell Command Hardening

The following constructs are rejected during command parsing to prevent injection and escape attacks:

| Construct | Reason |
|-----------|--------|
| Backtick substitution (`` `...` ``) | Arbitrary command execution |
| `$(...)` substitution | Arbitrary command execution |
| Redirections (`>`, `>>`, `<`) | Filesystem write/read bypass |
| Line continuations (`\` at end of line) | Parsing ambiguity |
| Heredoc bodies | Content injection risk (bodies are checked for safety) |

---

## 5. safeBins and safeBinProfiles

A curated set of binaries is considered safe for piping and data transformation. These are allowed in exec pipelines even when the primary command requires approval, provided they conform to strict argument rules.

### Default Safe Binaries

`jq`, `cut`, `uniq`, `head`, `tail`, `tr`, `wc` (plus `grep` and `sort` which have additional profile constraints).

### Safe Bin Profiles

Each binary has restrictions on positional arguments and flags:

| Binary | `maxPositional` | `deniedFlags` |
|--------|-----------------|---------------|
| `jq` | 1 | `--argfile`, `--rawfile`, `--slurpfile`, `--from-file`, `--library-path`, `-L`, `-f` |
| `grep` | 0 (stdin-only) | `--file`, `--exclude-from`, `--dereference-recursive`, `--directories`, `--recursive`, `-f`, `-d`, `-r`, `-R` |
| `cut` | 0 | (none) |
| `sort` | 0 | `--compress-program`, `--files0-from`, `--output`, `-o` |
| `head` | 0 | (none) |
| `tail` | 0 | (none) |
| `uniq` | 0 | (none) |
| `tr` | 1-2 | (none) |
| `wc` | 0 | `--files0-from` |

### Additional Restrictions

- **Glob tokens** (`*`, `?`, `[`, `]`): Rejected in arguments to prevent uncontrolled file expansion.
- **Path-like tokens**: Rejected as positional arguments to prevent file access through safe bins.

### Trusted Directories

Safe bin commands are resolved to absolute paths from trusted directories only:

```
/bin
/usr/bin
/usr/local/bin
/opt/homebrew/bin
/opt/local/bin
/snap/bin
/run/current-system/sw/bin
```

### Command Re-rendering

After validation, safe bin commands are re-rendered with:
- Single-quoted arguments (preventing shell interpretation)
- Absolute paths to the binary (preventing PATH hijacking)

---

## 6. Sandboxing

OpenClaw supports Docker-based sandboxing for exec commands and browser sessions. Sandboxing isolates agent-executed code from the host system.

### Docker Container Security Defaults

The following flags are applied **unconditionally** and cannot be disabled:

```
--read-only
--tmpfs /tmp
--tmpfs /var/tmp
--tmpfs /run
--network none
--cap-drop ALL
--security-opt no-new-privileges
```

Optional security features (configurable):

| Feature | Description |
|---------|-------------|
| `seccomp` | Custom seccomp profile |
| `apparmor` | AppArmor profile |
| `pids-limit` | Maximum number of processes |
| `memory` | Memory limit |
| `cpu` | CPU limit |
| `ulimits` | Resource ulimits |

### Sandbox Modes

| Mode | Behavior |
|------|----------|
| `off` | No sandboxing |
| `non-main` | Sandboxing enabled for groups/channels (non-main contexts) |
| `all` | Sandboxing enabled for all sessions |

### Sandbox Scope

| Scope | Behavior |
|-------|----------|
| `session` | One container per session |
| `agent` | One container per agent (default) |
| `shared` | Single shared container for all sessions |

### Workspace Access

| Mode | Mount Point | Permissions |
|------|-------------|-------------|
| `none` | Sandbox workspace (default) | Isolated, no host access |
| `ro` | `/agent` | Read-only access to host workspace |
| `rw` | `/workspace` | Read-write access to host workspace |

### Environment Variable Sanitization

Environment variables are sanitized before being passed into sandboxed containers.

**Blocked patterns** (variables matching any of these are removed):

- API key variables: `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, and similar provider-specific keys
- Bot tokens
- Cloud credentials
- Generic sensitive pattern: `/_?(API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|SECRET)$/i`
- Values containing null bytes
- Values exceeding 32,768 characters

**Strict mode**: When enabled, only the following variables are passed through:

```
LANG, LC_*, PATH, HOME, USER, SHELL, TERM, TZ, NODE_ENV
```

### Bind Mount Validation

Bind mounts are validated to prevent container escape and host compromise:

- **Blocked paths**: `/etc`, `/proc`, `/sys`, `/dev`, `/root`, `/boot`, `/run`, `docker.sock`
- **Non-absolute paths**: Rejected
- **Root mount** (`/`): Blocked
- **Symlink escape hardening**: Mount sources are resolved through symlinks; escapes outside allowed boundaries are rejected
- **Network mode `host`**: Blocked
- **Seccomp/AppArmor `unconfined`**: Blocked

### Browser Sandboxing

Browser sessions have additional isolation measures:

| Feature | Detail |
|---------|--------|
| Network | Dedicated Docker network (isolated from other containers) |
| CDP port | Bound to `127.0.0.1` only |
| noVNC password | Auto-generated (8 hex characters) |
| Observer tokens | Single-use with 5-minute expiry |
| Bridge auth | Always required |

### Sandbox Tool Policy Defaults

Sandboxed sessions have their own default tool policy:

**Allow**:
```
exec, process, read, write, edit, apply_patch, image, sessions_*, session_status
```

**Deny**:
```
browser, canvas, nodes, cron, gateway, all channels
```

**Policy priority**: agent-level policy > global policy > sandbox defaults.

The `image` tool is auto-injected into the sandbox allow list unless explicitly denied by a higher-priority policy.

---

## 7. Elevated Mode

Elevated mode allows agents to run commands directly on the gateway host instead of inside a sandbox. This is inherently dangerous and is gated behind multiple safeguards.

### Elevation Levels

| Command | Behavior |
|---------|----------|
| `/elevated on` | Run on gateway host **with** approval (`security=allowlist`, `ask=on-miss`) |
| `/elevated full` | Run on host with **no** approval, **no** allowlist, **no** restrictions |

### Access Gates

Elevated mode is controlled by a hierarchy of gates:

1. **`tools.elevated.enabled`** -- Global toggle. If `false`, elevated mode is unavailable entirely.
2. **`tools.elevated.allowFrom.<provider>`** -- Per-provider sender lists. Only senders matching the configured list for their provider can activate elevated mode.
3. **Per-agent overrides** -- Agents can have their own elevated mode settings, but these can only **further restrict** (never relax) the global/provider-level gates.

---

## 8. Filesystem Security

Beyond sandboxing and exec approvals, OpenClaw enforces filesystem-level protections for the `read`, `write`, `edit`, and `apply_patch` tools.

### Workspace Restrictions

| Setting | Default | Effect |
|---------|---------|--------|
| `tools.fs.workspaceOnly` | `false` | When `true`, restricts `read`, `write`, and `edit` to the configured workspace directory |
| `tools.exec.applyPatch.workspaceOnly` | `true` | Restricts `apply_patch` operations to the workspace directory |

### Path Traversal Prevention

The `resolveSandboxPath` function prevents directory traversal attacks:

- Throws an error if a relative path begins with `..`
- Walks each path component individually
- Resolves the real target of any symlinks encountered
- Throws if the resolved path falls outside the allowed root directory

### Symlink Handling

Symlinks are resolved defensively:

1. Each component of the path is walked sequentially.
2. When a symlink is encountered, its real target is resolved.
3. If the resolved target is outside the sandbox or workspace root, the operation is rejected with an error.

### Host Environment Validation

When running outside a sandbox (e.g., in elevated mode or with sandboxing off):

- Dangerous environment variables are blocked from being set or modified.
- Custom `PATH` values are strictly blocked to prevent binary hijacking.

### Script Preflight Checks

Before executing Python or Node.js scripts, a preflight scan is performed:

- Scripts are scanned for shell variable injection patterns.
- Detected injection attempts cause the execution to be rejected before the script runs.

---

## 9. Gateway HTTP Tool Deny List

When tools are invoked via the HTTP gateway (`POST /tools/invoke`), the following tools are unconditionally denied:

| Tool | Reason |
|------|--------|
| `sessions_spawn` | Remote code execution risk |
| `sessions_send` | Message injection risk |
| `gateway` | Reconfiguration risk |
| `whatsapp_login` | Hangs on HTTP (requires interactive flow) |

These restrictions apply regardless of the caller's permissions or the session's tool policy. They are hardcoded in the gateway layer and cannot be overridden by configuration.
