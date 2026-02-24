# Pi Coding Agent Security Model

Pi Coding Agent (`@mariozechner/pi-coding-agent`) is the underlying agent framework. OpenClaw builds all its security layers on top of Pi's extension hooks. Understanding Pi's model is essential because it defines the FLOOR of what's possible.

## 1. Trust Model: Trust the User

Pi has NO built-in sandboxing, NO default tool approval, NO extension code verification. All tools execute with the full permissions of the running process. The bash tool uses `spawn()` with the user's shell — no filtering, no path restrictions.

This is by design. Pi provides hooks for building security; it doesn't enforce any.

## 2. Extension Event System

The security-critical events:

| Event | Can Do |
|-------|--------|
| `tool_call` | BLOCK any tool execution. Returns `{ block: true, reason }`. Primary security interception point. Handler errors propagate and block (fail-safe). |
| `tool_result` | MODIFY tool results (content, details, isError). Handlers chain like middleware. |
| `context` | Modify entire message context before LLM call. Receives deep clone (structuredClone). |
| `before_agent_start` | Inject messages, replace system prompt per-turn. |
| `input` | Intercept, transform, or fully handle user input. Three outcomes: continue, transform, handled. |
| `user_bash` | Intercept user `!` commands. |
| `session_before_*` | Cancel session switching, forking, compaction, tree navigation. |

Informational events (observe only): session_start, session_switch, agent_start, agent_end, turn_start, turn_end, message_*, tool_execution_*, model_select, resources_discover.

## 3. Tool Call Blocking

`wrapToolWithExtensions()` wraps every tool. Before execution, calls `runner.emitToolCall()`. If any handler returns `{ block: true }`, the tool throws an error. If a handler THROWS, execution is also blocked (fail-safe — no try/catch on tool_call handlers, unlike other events).

Handlers iterate in extension load order. First block short-circuits.

ToolCallEventResult is limited to `{ block?: boolean, reason?: string }`. Cannot modify tool inputs — only block or allow.

## 4. Pluggable Operations (Sandboxing Hook Points)

All built-in tools have pluggable Operations interfaces: `BashOperations`, `ReadOperations`, `WriteOperations`, `EditOperations`, `GrepOperations`, `FindOperations`, `LsOperations`. These are where OpenClaw injects Docker sandboxing.

`BashSpawnHook` allows modifying command, cwd, and environment before execution.

## 5. Extension Loading

Via `jiti` (JIT TypeScript/ESM loader). Same process, full Node.js capabilities. No sandboxing, no capability restriction, no code signing. Can access node:fs, node:child_process, node:net, etc.

Auto-discovery: global (`~/.pi/agent/extensions/`), project-local (`<cwd>/.pi/extensions/`), configured, npm/git packages. Project-local is a supply-chain risk.

During loading, action methods are stubbed to throw (prevents calling sendMessage etc. during factory phase). Methods become available after `runner.bindCore()`.

## 6. Extension Capabilities

Full list of what an extension can do:

- Register tools / override built-in tools (same name = replace)
- Register providers (redirect API calls to arbitrary endpoints)
- Execute shell commands (pi.exec())
- Send messages to LLM (pi.sendMessage(), pi.sendUserMessage())
- Access model registry, session data (read-only)
- Shutdown agent, trigger compaction
- No isolation between extensions (shared process, EventBus, runtime)

## 7. Settings Security

Settings from `~/.pi/agent/settings.json` (global) and `<cwd>/.pi/settings.json` (project, overrides global).

Security-relevant: `extensions` (code paths), `packages` (npm/git auto-installs), `shellPath` (custom shell), `shellCommandPrefix` (prepended to EVERY bash command — injection vector in malicious repos), `images.blockImages` (defense-in-depth).

## 8. Auth & Credentials

Auth.json: 0o600 permissions, file locking (proper-lockfile, 30s stale detection). API key resolution: CLI override -> stored credentials -> OAuth with auto-refresh -> env vars -> fallback resolver. Dynamic per-LLM-call resolution (supports short-lived tokens).

Config values support `!` prefix for shell command execution (e.g., `"!pass show my-api-key"`). Results cached per process lifetime.

## 9. What Pi Does NOT Have

- No sandboxing (all tools run with user's full permissions)
- No tool approval UI by default
- No extension code verification (no signing, no checksums)
- No rate limiting on tool calls
- No network isolation
- No filesystem path restrictions
- Project-local extensions auto-execute without warning

## 10. How OpenClaw Adds Security

OpenClaw layers these on top of Pi:

- Docker sandboxing (read-only root, no network, cap-drop ALL, no-new-privileges)
- Tool profiles and allow/deny policy pipeline
- Exec approval system with allowlists and safeBins
- Channel access control (DM pairing, group allowlists)
- Gateway authentication (token, password, trusted-proxy, device identity)
- Environment variable sanitization
- Bind mount validation
- Safe prompt wrapping for external content
- Security audit CLI
