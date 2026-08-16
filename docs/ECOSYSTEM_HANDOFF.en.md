# Community Labs Handoff

> Maintainer baseline for `deepseek-harness-suite`. Date: 2026-08-16.

This repository is **Community Labs**. It is an experimental source for validating
official SDK transport, the Bridge, advanced TUI / Desktop UX, security controls,
Checkpoint, Undo, audit, and runtime probes. It is not a second user distribution.

## Non-negotiable boundaries

- `dsh-community` is the only canonical community product and download entry.
- Do not continue developing `dsh-community-edition` as a second product line.
- Do not reimplement the official Agent loop, Session persistence, tool execution, or core packages.
- Do not treat README claims, green unit tests, or fallback success as proof of Runtime E2E.
- Unknown capabilities fail closed.
- Do not add new UI, commands, dashboards, or large architecture before the current Reality Gate seams are closed.

## Current status

### Current ecosystem phase

```text
Phase 2 — Edition → Community       ✅ completed
Phase 3 — 3-OS Stable baseline      ✅ v0.1.2 published
Phase 4 — Distribution Reality Gate 🔄 active
  ├─ Plugin supply chain            ✅ main work complete (9/9 install + compose)
  └─ Marketplace UX                 ✅ main work complete (digest + provenance)
Phase 5 — Handbook drift CI         ⏳ not started
```

`v0.1.2` is the fixed three-platform Stable baseline. Current `dsh-community` `main`
is a post-release reliability line: `918f004` improves Windows dependency staging and
ready stamps, while `e487cf0` shows a loading window before first-launch extraction.
Do not claim those fixes are in the published `v0.1.2` assets without a new Release.

### Distribution Reality Gate

The next evidence must come from the exact files downloaded from the `v0.1.2` Release,
not from main-source builds or generic CI:

```text
Windows clean VM → EXE install → first launch → key → new/resume → plugin → restart
macOS clean host → dmg install → first launch → key → new/resume → plugin → restart
Linux clean host → AppImage → first launch → key → new/resume → plugin → restart
```

Uninstall/reinstall, upgrade, bad network, missing credentials, interrupted Runtime
extraction, and Web ↔ Desktop ↔ TUI Session sharing remain exact-artifact acceptance
scenarios and must be labelled `[UNVERIFIED]` until actually run.

### Current Community release snapshot

```text
Stable Release:   v0.1.2
Preview Release:  v0.1.2-preview (historical Preview retained for regression comparison)
Codebase Trunk:   0.1.2
```

The v0.1.2 GitHub Release publishes the Linux AppImage, macOS dmg, and Windows NSIS
installer. Suite remains an experimental source and is not a download channel.

| Area | Status | Evidence boundary |
|---|---|---|
| Official Session isolation | `[REAL]` `[READ-SAFE]` | Official `~/.dsh/sessions` is read-only; Suite data uses `~/.dsh/suite_sessions`. |
| Checkpoint workspace jail | `[WORKSPACE-JAIL]` | Canonical paths, existing-ancestor resolution, symlink escape, traversal, NUL, and control-character checks are covered. |
| Durable Checkpoint recovery | `[NOT_IMPLEMENTED]` | Records are mainly process-lifetime memory; no restart restore or crash recovery claim. |
| Capability-based Risk Engine | `[FAIL-CLOSED]` | Unknown tools and high-risk capabilities require rejection or approval. |
| Shell policy | `[FAIL-CLOSED]` | Compound operators, redirection, substitutions, pipelines, and control characters are rejected; deeper parser/argv hardening remains future work. |
| Official SDK integration | `[LABS]` | The official SDK dependency and Bridge direction exist; dependency presence is not SDK E2E proof. |
| SDK JSON-RPC E2E | `[UNVERIFIED]` | The correct JSON-RPC runtime entrypoint and `executionMode === sdk_jsonrpc` still need a no-fallback test. |
| SessionEvent adapter | `[PARTIAL]` | Decode `event.type` and `event.data` through typed adapters; do not guess fields with `any`. |
| Fallback replay safety | `[PARTIAL]` | Never replay a prompt after the official Runtime has accepted it. |
| Runtime approval loop | `[BLOCKED_BY_UPSTREAM]` | The SDK does not yet expose the complete server-to-client approval response path. |
| Dynamic contract probe | `[PROBE]` | A probe observes current behavior; it does not establish a stable contract or CI reliability by itself. |

## P0 order

1. Replace shell string-prefix policy with parsing of executable, argv, redirection,
   pipelines, substitutions, and side effects; reject unverified compound syntax.
2. Prove the true SDK JSON-RPC runtime path with a hard `executionMode === sdk_jsonrpc`
   assertion and fallback disabled.
3. Finish a typed `SessionEvent` adapter based on `notification.params.event.type`
   and `event.data`.
4. Track `NOT_STARTED`, `INITIALIZED`, `PROMPT_ENQUEUED`, and `ACTIVE`; after prompt
   enqueue, fail loudly instead of automatically replaying the prompt.

## Promotion path

```text
Reality Gate
  → Upstream Contract Gate
  → Security Boundary Gate
  → Real E2E
  → Cross-platform Smoke
  → Failure-path Test
  → Documentation
  → dsh-community Canary
  → Preview
  → Stable
```

Suite remains a research source, not a release channel. The full Chinese handoff is
[`docs/ECOSYSTEM_HANDOFF.md`](ECOSYSTEM_HANDOFF.md); the ecosystem map and operational
evidence live in the [DeepSeek Harness Handbook](https://kamanager2012.github.io/deepseek-harness-handbook/).

## Reporting template

Every Labs task should report:

```text
Status: [REAL] / [PARTIAL] / [LABS] / [PROBE] / [UNVERIFIED]
Scope: files and modules actually changed
Evidence: commands, tests, exit codes, E2E, and probes actually run
Unverified: mocks, fallbacks, upstream blocks, and unrun paths
Risk: replay, permission, workspace, failure-path, and cross-platform gaps
Next: the smallest gate-approved next step
```

Never replace evidence with “complete”, “fully secure”, “production-ready”, or
“100% compatible”.
