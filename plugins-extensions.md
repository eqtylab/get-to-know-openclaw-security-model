# Plugins & Extensions

## 1. Plugin Loading Pipeline

Multi-step validation:

1. **Discovery**: `discoverOpenClawPlugins()` finds plugins in known paths and workspace.
2. **Manifest validation**: requires valid `configSchema`.
3. **Path containment**: `isPathInsideWithRealpath()` ensures entry point doesn't escape plugin root (symlink-aware).
4. **Config validation** against JSON schema.
5. **Module loading** via Jiti (TypeScript-compatible).
6. **Registration**: plugin calls `register(api)` to register tools, hooks, channels, etc.

## 2. Plugin Allowlist

`plugins.allow`: array of trusted plugin IDs. Empty = warns but does NOT block. To block: use `plugins.deny` (explicit deny list, takes precedence).

**Provenance tracking**: loader tracks whether plugin was installed via `plugins.installs`, discovered from `plugins.load.paths`, or appeared untracked. Untracked = diagnostic warning.

## 3. Plugin Capabilities

Via `OpenClawPluginApi`, plugins can:

- Register tools (LLM-callable functions)
- Register hooks (event handlers)
- Register HTTP handlers and routes (custom endpoints on gateway)
- Register channels (messaging providers)
- Register providers (model providers)
- Register gateway methods (WebSocket API methods)
- Register CLI commands
- Register services
- Access full `OpenClawConfig` (including sensitive values)
- Access logger

Plugins run IN-PROCESS with the Gateway. Same trust as the Gateway process itself.

## 4. Plugin HTTP Routes -- NO Gateway Auth

**CRITICAL**: Plugin HTTP routes dispatched WITHOUT gateway authentication. Only `/api/channels/*` routes get auto-gated. Other plugin routes must implement their own auth. The dispatch layer simply matches URL paths and calls handlers.

## 5. Plugin Code Safety Scanning

During installation, `skillScanner.scanDirectoryWithSummary()` scans for dangerous patterns. This is WARN-ONLY and never blocks install. Critical patterns logged as warnings; suspicious patterns deferred to `openclaw security audit --deep`.

## 6. npm Install Risks

`npm install --omit=dev` executes npm lifecycle scripts (preinstall, postinstall) from dependencies. Known supply chain risk. Recommendations:

- Prefer pinned, exact versions (`@scope/pkg@1.2.3`)
- Inspect unpacked code before enabling
- Install path: `~/.openclaw/extensions/<pluginId>/`

## 7. ClawHub & VirusTotal Integration

Skills published to ClawHub are scanned:

1. Deterministic packaging (ZIP with consistent timestamps + `_meta.json`)
2. SHA-256 hash computation
3. VirusTotal lookup (hash-based)
4. Upload for Code Insight analysis (Gemini-powered security review)
5. Auto-approval for "benign" verdict; warning for "suspicious"; blocked for "malicious"
6. Daily re-scans of all active skills

Not a silver bullet -- won't catch natural-language prompt injection payloads.

## 8. Pi Extension Security (The Underlying Framework)

Pi Coding Agent extensions are the foundation. Key differences from OpenClaw plugins:

Extension loading via `jiti`: same process, full Node.js capabilities, no sandboxing, no code signing.

**Auto-discovery locations:**

- Global: `~/.pi/agent/extensions/`
- Project-local: `<cwd>/.pi/extensions/` (supply-chain risk -- malicious repo could include extensions)
- Configured in `settings.json`
- npm/git packages

**Extension capabilities via `ExtensionAPI`:**

- Register/override tools (can replace built-in read, bash, edit, write)
- Intercept all tool calls (`tool_call` event -- can block with `{ block: true, reason }`)
- Modify tool results (`tool_result` event -- chained like middleware)
- Modify context before LLM calls (`context` event -- receives deep clone)
- Replace system prompt (`before_agent_start` event)
- Intercept/transform/handle user input (`input` event)
- Execute shell commands (`pi.exec()`)
- Register providers (can redirect API calls to arbitrary endpoints)
- Access session data (read-only via `ReadonlySessionManager`)

No isolation between extensions. Shared process, shared EventBus, shared runtime. Handler execution order = load order.

`tool_call` handler errors propagate and BLOCK the tool (fail-safe). Other handler errors caught and logged.

Reserved keybindings cannot be overridden: interrupt, clear, exit, suspend, etc. Extension commands that conflict with built-ins are skipped.

## 9. Project-Local Settings Risk

Pi project settings (`<cwd>/.pi/settings.json`) override global settings. Can change model, add extensions, modify `shellCommandPrefix` (prepended to EVERY bash command). A malicious project settings file = command injection.
