# ClawHub & Skills Safety

This document covers the security model for OpenClaw skills and ClawHub, the public skill registry. Skills are the primary extension mechanism for OpenClaw agents — and the primary supply chain risk.

---

## 1. What Skills Are

Skills are self-contained capability packages written as `SKILL.md` files. They contain natural language instructions that the agent follows using its full tool set. A skill can instruct the agent to run shell commands, read and write files, make network requests, and interact with any tool available in the session.

Skills are effectively **executable code written in natural language**. They have no sandbox, no privilege restriction, and no isolation from other skills or the agent's tools. A malicious skill has the same capabilities as a malicious operator instruction.

This is why supply chain security for skills is critical.

---

## 2. ClawHub

ClawHub ([clawhub.ai](https://clawhub.ai)) is the public skill registry for OpenClaw. All skills are public, open, and visible to everyone. It functions as a versioned store of skill bundles, a discovery surface for search and tags, and the default source for `clawhub install` and `clawhub update` CLI commands.

### Publishing Requirements

- GitHub account must be at least **one week old** to publish
- Every skill requires a valid `SKILL.md` with YAML frontmatter (`name`, `description`)
- Bundles have a **50 MB** size limit
- Skills are versioned with semver

### Reporting & Moderation

- Any signed-in user can report a skill with a required reason
- Each user can have up to **20 active reports** at a time
- Skills with more than **3 unique reports** are **auto-hidden** by default
- Moderators can view hidden skills, unhide them, delete them, or ban users

### Badge System

Skills can carry badges that signal trust level:

| Badge | Meaning |
|-------|---------|
| `official` | Published by OpenClaw or a verified partner |
| `highlighted` | Featured by moderators |
| `deprecated` | No longer maintained |
| `redactionApproved` | Approved for use with redaction-sensitive workflows |

---

## 3. VirusTotal Partnership

OpenClaw partners with VirusTotal to scan all skills published to ClawHub. This was announced February 7, 2026.

### How It Works

When a skill is published to ClawHub:

1. **Deterministic Packaging** — Skill files are bundled into a ZIP with consistent compression and timestamps, along with a `_meta.json` containing publisher info and version history
2. **Hash Computation** — A SHA-256 hash is computed for the entire bundle, creating a unique fingerprint
3. **VirusTotal Lookup** — The hash is checked against VirusTotal's database. If the file exists with a Code Insight verdict, results are returned immediately
4. **Upload & Analysis** — If not found (or no AI analysis exists), the bundle is uploaded to VirusTotal for fresh scanning via their v3 API
5. **Code Insight** — VirusTotal's LLM-powered Code Insight (powered by Gemini) performs a security-focused analysis of the entire skill package, starting from `SKILL.md` and including any referenced scripts or resources. It analyzes what the code *actually does* from a security perspective: whether it downloads and executes external code, accesses sensitive data, performs network operations, or embeds instructions that could coerce the agent into unsafe behavior
6. **Auto-Approval** — Skills with a "benign" Code Insight verdict are automatically approved. Suspicious skills are marked with a warning. Malicious skills are instantly blocked from download
7. **Daily Re-scans** — All active skills are re-scanned daily to detect if a previously clean skill becomes flagged

Scan results are displayed on every skill page and in version history, with direct links to the full VirusTotal report.

### What This Is — And What It Isn't

VirusTotal scanning provides:

- **Detection of known malware** — Trojans, stealers, backdoors, malicious payloads
- **Behavioral analysis** — Code Insight identifies suspicious patterns even in novel threats
- **Supply chain visibility** — Catching compromised dependencies and embedded executables

It does **not** catch:

- **Natural language manipulation** — A skill that uses prose to instruct an agent to do something malicious won't trigger a virus signature
- **Prompt injection payloads** — Carefully crafted text that manipulates the agent won't show up in a threat database
- **Obfuscated intent** — Skills that are technically benign but behaviorally harmful through indirect instruction

This is one layer of defense in depth, not a silver bullet.

---

## 4. Metadata Moderation

Before VirusTotal scanning, ClawHub applies regex-based moderation patterns against skill metadata (slug, display name, summary, frontmatter, file paths). This is implemented in the ClawHub backend (`convex/lib/moderation.ts`).

### Flag Patterns

| Pattern | Targets |
|---------|---------|
| `/(keepcold131\/ClawdAuthenticatorTool\|ClawdAuthenticatorTool)/i` | Known-bad identifiers |
| `/(malware\|stealer\|phish\|phishing\|keylogger)/i` | Malware keywords |
| `/(api[-_ ]?key\|token\|password\|private key\|secret)/i` | Credential-related keywords |
| `/(wallet\|seed phrase\|mnemonic\|crypto)/i` | Crypto/wallet keywords |
| `/(discord\.gg\|webhook\|hooks\.slack)/i` | Suspicious webhook URLs |
| `/(curl[^\n]+\|\s*(sh\|bash))/i` | Pipe-to-shell patterns |
| `/(bit\.ly\|tinyurl\.com\|t\.co\|goo\.gl\|is\.gd)/i` | URL shorteners |

### Limitations

- Only checks metadata fields, **not actual skill code content** (that's VirusTotal's job)
- Simple regex patterns are easily bypassed with obfuscation
- No behavioral analysis at the metadata level

---

## 5. Local Skill Scanner

OpenClaw includes a pattern-based code scanner (`src/security/skill-scanner.ts`) that runs locally during skill and plugin installation. It is **warn-only** — it never blocks installation.

### Scan Rules

| Rule ID | Severity | What It Detects |
|---------|----------|-----------------|
| `dangerous-exec` | critical | Shell command execution (`exec`, `spawn`, `execFile`, `execSync`, etc.) — requires `child_process` context |
| `dynamic-code-execution` | critical | `eval()` or `new Function()` |
| `crypto-mining` | critical | Mining references (`stratum+tcp`, `coinhive`, `cryptonight`, `xmrig`) |
| `env-harvesting` | critical | `process.env` access combined with network send (`fetch`, `http.request`) |
| `potential-exfiltration` | warn | File read (`readFileSync`, `readFile`) combined with network send |
| `obfuscated-code` | warn | 6+ hex-encoded character sequences or large base64 payloads (200+ chars) |
| `suspicious-network` | warn | WebSocket connections to non-standard ports (excluding 80, 443, 8080, 8443, 3000) |

### Scan Scope

- **File types**: `.js`, `.ts`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.jsx`, `.tsx`
- **Limits**: 500 files max, 1 MB per file
- **Line rules**: One finding per rule per file (deduplicated)
- **Source rules**: Deduplicated by `ruleId::message`
- **Evidence**: Truncated to 120 characters per finding

### Integration Points

| Context | Behavior |
|---------|----------|
| Plugin installation (`plugins/install.ts`) | Scans plugin source. Critical findings logged as warnings. Never blocks. |
| Skill installation (`agents/skills-install.ts`) | Scans skill directory. Critical findings logged as warnings. Never blocks. |
| `openclaw security audit --deep` | Scans all installed plugins and non-bundled skills. Reports findings as audit checkIds (`plugins.code_safety`, `skills.code_safety`). |

### Why Warn-Only?

The scanner detects patterns that *could* be malicious but are also common in legitimate code. A skill that uses `child_process.spawn` might be a malicious reverse shell or a legitimate build tool. Blocking on pattern matches alone would produce too many false positives. The scanner provides signal for the operator to investigate, not an automated verdict.

---

## 6. Skill Loading & Discovery

### Discovery Locations (Precedence Order)

| Location | Type | Precedence |
|----------|------|------------|
| `<workspace>/skills/` | Per-agent workspace | Highest |
| `~/.openclaw/skills/` | Shared across agents | Medium |
| Bundled skills (npm/app) | Shipped with OpenClaw | Lowest |
| `skills.load.extraDirs` | Configured additional dirs | Lowest |

Within Pi (the underlying framework), additional discovery locations exist:

| Location | Type |
|----------|------|
| `~/.pi/agent/skills/` | Global (Pi) |
| `~/.agents/skills/` | Global (cross-agent) |
| `.pi/skills/` in CWD | Project-local (Pi) |
| `.agents/skills/` in CWD and ancestors | Project-local |
| Extension-provided paths | Via `resources_discover` event |
| CLI `--skill <path>` | Explicit override |

Name collisions are resolved by keeping the first skill found. Duplicates produce a diagnostic warning.

### Progressive Disclosure

Only skill **names, descriptions, and file paths** are included in the system prompt (as an XML block). The full skill content is loaded on demand when the model uses the `read` tool or the user types `/skill:name`. This keeps prompt context lightweight while making capabilities discoverable.

### Session Snapshot

OpenClaw snapshots eligible skills when a session starts and reuses that list for subsequent turns. Changes to skills or config take effect on the next new session.

### Gating Rules

Skills can declare requirements in `metadata.openclaw` frontmatter:

| Gate | Effect |
|------|--------|
| `always: true` | Skip all other gates |
| `os` | Platform filter (`darwin`, `linux`, `win32`) |
| `requires.bins` | Required binaries on PATH |
| `requires.anyBins` | At least one binary on PATH |
| `requires.env` | Required environment variables |
| `requires.config` | Required `openclaw.json` config paths |

Skills without `metadata.openclaw` are always eligible.

---

## 7. Skill Security Model

### What Skills Can Do

When loaded, a skill's instructions become part of the conversation context. The agent follows them using the same tools available in the session — `exec`, `read`, `write`, `edit`, `web_fetch`, and any extension-registered tools. There is no per-skill sandbox, no per-skill tool restriction, and no isolation between skills.

The `allowed-tools` frontmatter field is documented in the Agent Skills specification but is **not implemented** in the runtime. It is aspirational only.

### Supply Chain Risks

| Vector | Risk | Current Mitigation |
|--------|------|-------------------|
| Malicious skill on ClawHub | Agent executes attacker-controlled instructions | VirusTotal scanning, metadata moderation, community reporting |
| Project-local skill injection | `.pi/skills/` or `.agents/skills/` in a cloned repo auto-loads | No mitigation — auto-discovered without verification |
| Skill update poisoning | Previously safe skill updated with malicious content | Content hash comparison prompts before overwrite; daily VirusTotal re-scans |
| Credential harvesting via skills | Skill instructs agent to read and exfiltrate secrets | Tool policy deny lists, sandbox env var sanitization, exec approval gates |
| Extension-injected skills | Extensions can register skill paths via `resources_discover` | Extension trust model (in-process, operator-approved) |

### What Pi Does NOT Provide

Pi (the underlying framework) provides no skill-level security:

- No sandboxing or isolation for skills
- No code signing or integrity verification
- No content validation beyond structural checks (name format, description length)
- No tool restriction per skill (despite `allowed-tools` being in the spec)
- Project-local skills auto-execute without warning

All skill security is layered on by OpenClaw (tool policies, sandbox, exec approvals) and ClawHub (VirusTotal, moderation, reporting).

---

## 8. Threat Model (MITRE ATLAS)

OpenClaw maintains a MITRE ATLAS-based threat model (`docs/security/THREAT-MODEL-ATLAS.md`) that identifies skill-specific threats.

### Critical Skill Threats

| Threat ID | Title | Risk | Priority |
|-----------|-------|------|----------|
| T-PERSIST-001 | Malicious Skill Installation | Critical | P0 |
| T-PERSIST-002 | Skill Update Poisoning | Medium | P2 |
| T-EXFIL-003 | Credential Harvesting from Skills | Critical | P0 |
| T-EVADE-001 | Moderation Pattern Bypass | Medium | P2 |

### Critical Attack Chains

1. **Skill-Based Data Theft**: Malicious skill installed (T-PERSIST-001) → moderation bypass (T-EVADE-001) → credential harvesting (T-EXFIL-003)
2. **Prompt Injection to RCE**: Direct injection (T-EXEC-001) → exec approval bypass (T-EXEC-004) → unauthorized command execution (T-IMPACT-001)

### Defense Layers

| Layer | What It Catches | What It Misses |
|-------|----------------|----------------|
| VirusTotal Code Insight | Known malware, suspicious code patterns, embedded payloads | Natural language manipulation, prompt injection |
| Metadata moderation | Known-bad identifiers, suspicious keywords | Obfuscated keywords, novel attack patterns |
| Local skill scanner | Shell exec, eval, mining, env harvesting | Natural language instructions, legitimate-looking code |
| Community reporting | User-reported suspicious skills | Skills that appear benign on the surface |
| Tool policy pipeline | Blocks denied tools regardless of skill instructions | Permitted tools used maliciously |
| Exec approval gates | Requires approval for dangerous commands | Social engineering the operator into approving |
| Docker sandbox | Contains file/network access | Skills running on unsandboxed agents |

---

## 9. Operator Guidance

### For Skill Consumers

- **Treat third-party skills as untrusted code.** Read them before enabling.
- **Prefer sandboxed runs** for untrusted inputs and risky tools.
- **Check VirusTotal scan status** on the ClawHub skill page before installing.
- **Use `skills.entries.<name>.enabled: false`** to disable specific skills.
- **Review project-local skills** (`.pi/skills/`, `.agents/skills/`) in cloned repositories before running agents in those directories.
- **Report suspicious skills** to security@openclaw.ai.

### For Skill Publishers

- Skills are scanned automatically on publish via VirusTotal
- Benign verdicts result in auto-approval; suspicious verdicts add a warning; malicious verdicts block download
- False positives can be reported to security@openclaw.ai for review
- Check scan status on your skill's detail page (includes direct VirusTotal report link)

### Environment Variables in Skills

`skills.entries.<name>.env` and `skills.entries.<name>.apiKey` inject secrets into the **host process** for that agent turn only. They do **not** propagate into Docker sandboxes. For sandboxed agents, use `agents.defaults.sandbox.docker.env` or bake environment into a custom image.

---

## 10. Security Program

The VirusTotal partnership is part of a broader security initiative at OpenClaw, led by Jamieson O'Reilly (founder of Dvuln, CREST Advisory Council member). The program includes:

- A [comprehensive threat model](https://trust.openclaw.ai) for the OpenClaw ecosystem (MITRE ATLAS)
- A public security roadmap tracking defensive engineering goals
- Security audit covering the entire codebase
- Formal security reporting process at security@openclaw.ai
- Formal verification models (TLA+/TLC) for gateway exposure, pairing, ingress gating, and session isolation
- Separate security repositories: `openclaw/openclaw` (core), `openclaw/clawhub` (registry), `openclaw/trust` (threat model)
