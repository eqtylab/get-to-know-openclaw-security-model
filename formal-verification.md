# Formal Verification (Security Models)

## What This Is (Plain English)

Most software security is tested by trying things and seeing if they break. Formal verification is different — it uses **math to prove that certain bad things can't happen**, even in situations nobody thought to test.

OpenClaw maintains a set of **TLA+ models** — small, precise descriptions of how critical security mechanisms are *supposed* to work. A tool called **TLC** (the TLA+ model checker) then exhaustively explores every possible sequence of events within a bounded state space: every ordering of messages, every race condition, every edge case. If any sequence violates a security property, TLC produces a **counterexample trace** — a step-by-step replay showing exactly how things went wrong.

Think of it like this: instead of writing a test that says "try these 5 scenarios and check the result," formal verification says "try **every possible scenario** up to this complexity bound and prove none of them break the rule."

### What the green/red pattern means

Each security claim has two model runs:

- **Green (positive)**: The model with correct implementation. TLC explores all states and finds no violations. This is the proof that the security property holds.
- **Red (negative)**: The model with a **deliberately introduced bug** — a realistic mistake a developer could make (e.g., removing an auth check, making a non-atomic operation). TLC finds a violation and produces a counterexample trace. This proves the model is actually checking something meaningful — if the "broken" version also passed, the model would be too weak.

The red runs are just as important as the green ones. A model that can't catch a known bug isn't providing real assurance.

### What this does NOT mean

- These are models of the security design, **not the TypeScript implementation itself**. The code could drift from the model.
- TLC explores a **bounded** state space. "No violations found" means "no violations within these bounds," not "mathematically impossible in all cases."
- Some claims depend on environmental assumptions (correct deployment, correct config). The model checks the logic, not whether you deployed it right.

---

## Where the Models Live

Models are maintained in a separate repository: [`vignesh07/openclaw-formal-models`](https://github.com/vignesh07/openclaw-formal-models).

### Reproducing Results

```bash
git clone https://github.com/vignesh07/openclaw-formal-models
cd openclaw-formal-models

# Java 11+ required (TLC runs on the JVM).
# The repo vendors a pinned tla2tools.jar and provides bin/tlc + Make targets.

make <target>
```

---

## Verified Security Claims

### 1. Gateway Exposure & Open Gateway Misconfiguration

**Claim**: Binding beyond loopback without authentication makes remote compromise possible. Token or password authentication blocks unauthenticated attackers.

This is the most basic security property — if you expose the gateway to the network without auth, anyone can talk to your agent. The model proves that token/password auth prevents this under the modeled assumptions.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make gateway-exposure-v2` | No violations |
| Green | `make gateway-exposure-v2-protected` | No violations |
| Red | `make gateway-exposure-v2-negative` | Counterexample found |

See also: `docs/gateway-exposure-matrix.md` in the models repo.

### 2. Nodes.run Pipeline (Highest-Risk Capability)

**Claim**: `nodes.run` requires (a) a node command allowlist plus declared commands and (b) live approval when configured. Approvals are tokenized to prevent replay.

`nodes.run` is the most dangerous capability in OpenClaw — it allows remote command execution between paired nodes. The model verifies that the full authorization chain (allowlist check → command declaration → live approval → single-use token) cannot be bypassed.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make nodes-pipeline` | No violations |
| Green | `make approvals-token` | No violations |
| Red | `make nodes-pipeline-negative` | Counterexample found |
| Red | `make approvals-token-negative` | Counterexample found |

### 3. Pairing Store (DM Gating)

**Claim**: Pairing requests respect TTL and pending-request caps.

Pairing is how new contacts get authorized to talk to the bot. The model proves that expired pairing codes can't be reused and that an attacker can't flood the system with unlimited pending requests.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make pairing` | No violations |
| Green | `make pairing-cap` | No violations |
| Red | `make pairing-negative` | Counterexample found |
| Red | `make pairing-cap-negative` | Counterexample found |

### 4. Ingress Gating (Mentions & Control-Command Bypass)

**Claim**: In group contexts requiring mention, an unauthorized "control command" cannot bypass mention gating.

When `requireMention` is enabled in a group, messages are only processed if they mention the bot. The model proves that control commands (like `/reset` or `/elevated`) can't sneak past this gate without a mention.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make ingress-gating` | No violations |
| Red | `make ingress-gating-negative` | Counterexample found |

### 5. Routing / Session-Key Isolation

**Claim**: DMs from distinct peers do not collapse into the same session unless explicitly linked or configured.

Session isolation is critical — if Alice's conversation bleeds into Bob's, that's a data leak. The model proves that the routing logic keeps sessions separate by default.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make routing-isolation` | No violations |
| Red | `make routing-isolation-negative` | Counterexample found |

---

## v1++ Extended Models (Concurrency & Retries)

These follow-on models tighten fidelity around real-world failure modes: non-atomic updates, retries, and message fan-out. These are the kinds of bugs that only appear under concurrent load and are nearly impossible to catch with conventional testing.

### 6. Pairing Store Concurrency & Idempotency

**Claim**: The pairing store enforces `MaxPending` and idempotency even under concurrent interleavings. Check-then-write must be atomic/locked. Refresh operations must not create duplicate entries.

Race conditions in pairing could allow an attacker to exceed the pending request cap by sending concurrent requests that all pass the "is there room?" check before any of them write. The model proves this can't happen with proper locking.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make pairing-race` | No violations (atomic cap check) |
| Green | `make pairing-idempotency` | No violations |
| Green | `make pairing-refresh` | No violations |
| Green | `make pairing-refresh-race` | No violations |
| Red | `make pairing-race-negative` | Counterexample (non-atomic begin/commit race) |
| Red | `make pairing-idempotency-negative` | Counterexample found |
| Red | `make pairing-refresh-negative` | Counterexample found |
| Red | `make pairing-refresh-race-negative` | Counterexample found |

### 7. Ingress Trace Correlation & Idempotency

**Claim**: Ingestion preserves trace correlation across fan-out and is idempotent under provider retries.

When one external event (e.g., a Telegram message) fans out into multiple internal messages, every part must keep the same trace/event identity. Provider retries must not cause double-processing. If provider event IDs are missing, deduplication falls back to a safe key (e.g., trace ID) to avoid dropping distinct events.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make ingress-trace` | No violations |
| Green | `make ingress-trace2` | No violations |
| Green | `make ingress-idempotency` | No violations |
| Green | `make ingress-dedupe-fallback` | No violations |
| Red | `make ingress-trace-negative` | Counterexample found |
| Red | `make ingress-trace2-negative` | Counterexample found |
| Red | `make ingress-idempotency-negative` | Counterexample found |
| Red | `make ingress-dedupe-fallback-negative` | Counterexample found |

### 8. Routing dmScope Precedence & identityLinks

**Claim**: Routing keeps DM sessions isolated by default. Channel-specific `dmScope` overrides win over global defaults. `identityLinks` collapse sessions only within explicitly linked groups, not across unrelated peers.

This model verifies the precedence chain: if you set `dmScope: "per-channel-peer"` globally but override it to `"per-peer"` for Telegram, the Telegram setting wins. And if you link Alice's WhatsApp and Telegram identities via `identityLinks`, their sessions merge — but Bob's sessions stay separate.

| Run | Target | Expected |
|-----|--------|----------|
| Green | `make routing-precedence` | No violations |
| Green | `make routing-identitylinks` | No violations |
| Red | `make routing-precedence-negative` | Counterexample found |
| Red | `make routing-identitylinks-negative` | Counterexample found |

---

## Coverage Summary

| Domain | Claims Modeled | Green Runs | Red Runs |
|--------|---------------|------------|----------|
| Gateway exposure | Auth enforcement on network-bound listeners | 2 | 1 |
| Nodes.run pipeline | Allowlist + approval + token anti-replay | 2 | 2 |
| Pairing store | TTL, caps, concurrency, idempotency, refresh | 6 | 6 |
| Ingress gating | Mention-required bypass prevention | 1 | 1 |
| Ingress traces | Correlation, idempotency, dedupe fallback | 4 | 4 |
| Routing/sessions | Isolation, dmScope precedence, identityLinks | 4 | 4 |
| **Total** | | **19** | **18** |

Every green run is a bounded proof. Every red run confirms the model catches real bugs. Together, they form an executable, attacker-driven security regression suite for OpenClaw's core authorization and isolation logic.
