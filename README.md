# DeepSeek Harness Community Suite (DSH-Suite)

> ⚡ **Official-Runtime Centric** Terminal & Desktop Distributions for DeepSeek Harness.

[![Contract CI](https://github.com/kamanager2012/deepseek-harness-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/kamanager2012/deepseek-harness-suite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Upstream Target: 0.1.0-rc.6](https://img.shields.io/badge/Official%20DSH-0.1.0--rc.6%20verified-green.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)

---

## 🎯 Reality Gate & Implementation Status

| Capability / Module | Status | Architectural Invariant & Evidence |
| :--- | :--- | :--- |
| **Official Source Ownership** | `[REAL]` | `Ownership = 0`. Zero vendored code. Runtime launched via official `@deepseek-ai/dsh`. |
| **Desktop Web Shell** | `[REAL]` | Controlled Electron shell hosting official localhost runtime with tray & clean process lifecycle. |
| **Process Tree Governance** | `[REAL]` | POSIX process group detachment + Windows `taskkill /T /F` (0 orphan 3080 port leaks). |
| **Dynamic Contract CI** | `[REAL]` | Live introspection probe against `dsh --dump-default-config` (128 plugins verified). |
| **TUI Visual Components** | `[REAL]` | `DiffViewer` (syntax highlighing), `ReasoningBox` (collapsible thought stream), `ToolCard`. |
| **Smart Risk Evaluator** | `[REAL]` | `DshRiskEvaluator` auto-approves safe read-only tools while strictly gating destructive commands. |
| **Runtime Execution Transport** | `[REAL]` | `DshRuntimeClient` spawns official headless profile & streams live events into TUI. |
| **Session Safety Gate** | `[READ-SAFE]` | Official `~/.dsh/sessions` is strictly **Read-Only** to prevent state corruption; Suite uses `~/.dsh/suite_sessions`. |
| **Diagnostics & Health** | `[REAL]` | `/doctor` executes five-layer system checks (Node version, process isolation, API keys, token budget). |
| **Tamper-Evident Audit** | `[REAL]` | `/audit` maintains cryptographic SHA-256 hash chains over every tool invocation & approval decision. |
| **Rollback & Fork** | `[UI-LEVEL]` | `/message-rewind` and `/conversation-fork` (UI-level rewind until upstream exposes runtime checkpoint APIs). |

---

## 🌟 Architecture

```text
Official @deepseek-ai/dsh Runtime (@0.1.0-rc.6)
   ↓
dsh-bridge (Anti-Corruption & Execution Transport)
   ↓
TUI / Desktop Frontends
   ↓
Dynamic Live Contract CI
```

---

## 📦 Packages & Distribution

| Package | Role | Status |
| :--- | :--- | :--- |
| [`@dsh-community/dsh-bridge`](./packages/dsh-bridge) | Anti-Corruption Layer, Runtime Client & Process Supervisor | Production Ready |
| [`@dsh-community/tui`](./apps/tui) | Claude Code level Terminal UX (Ink / Yoga) | Active / Headless Connected |
| [`@dsh-community/desktop`](./apps/desktop) | Zero-config Desktop Shell (Electron + Subprocess Manager) | Production Ready |

---

## 🚀 Terminal Commands (TUI)

- `/doctor` - Run five-layer environment & health diagnostics
- `/plugins [search]` - Discover verified plugins from the community registry
- `/audit` - Inspect cryptographic SHA-256 tamper-evident execution log
- `/provider [switch <id>]` - Inspect or switch model provider (DeepSeek, SiliconFlow, Ollama, vLLM, Ark)
- `/undo` - Roll back the latest file modification checkpoint
- `/export [markdown|json]` - Export structured session report with thought process
- `/sessions` - Discover sessions (Official + Suite)
- `/resume <id>` - Resume previous session
- `/save` - Save current session atomically to `~/.dsh/suite_sessions/`
- `/rollback [index]` - Message history rewind
- `/fork` - Branch conversation from current turn
- `Esc` - Interrupt current thought / turn generation

---

## 🛠️ Development & Dynamic Contract Testing

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run unit & contract tests
pnpm run test

# Run LIVE dynamic probe against official @deepseek-ai/dsh
npx tsx scripts/contract-checker.ts
```

---

## 📄 License
MIT © 2026 DeepSeek Harness Community Team
