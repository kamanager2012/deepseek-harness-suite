# DeepSeek Harness Community Suite (DSH-Suite)

> ⚡ **Official-Runtime Centric** Terminal & Desktop Distributions for DeepSeek Harness.

[![Contract CI](https://github.com/dsh-community/dsh-suite/actions/workflows/contract-ci.yml/badge.svg)](https://github.com/dsh-community/dsh-suite/actions/workflows/contract-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Architecture & Highlights

* **Official Source Ownership = 0**: Zero vendored copies of upstream monorepo packages. Official `@deepseek-ai/dsh` is treated strictly as an external runtime dependency.
* **Shared Single Source of Truth (`~/.dsh/`)**: `~/.dsh/sessions/` is shared across TUI, Desktop, and official Web UI. Start in terminal, resume on desktop.
* **Anti-Corruption Bridge (`@dsh-community/dsh-bridge`)**: Normalizes upstream events & streaming thoughts. Upstream version bumps require 0 UI code changes.
* **DSH Version Manager**: Pin or switch between verified upstream versions (`0.1.0-rc.7`, `0.1.0-rc.8`) backed by automated Contract CI.

---

## 📦 Packages & Distribution

| Package | Role | Release Channel |
| :--- | :--- | :--- |
| [`@dsh-community/dsh-bridge`](./packages/dsh-bridge) | Anti-Corruption Layer & Process Supervisor | NPM Package |
| [`@dsh-community/tui`](./apps/tui) | Claude Code level Terminal UX (Ink / Yoga) | NPM Binary (`dsh-tui`) |
| [`@dsh-community/desktop`](./apps/desktop) | Zero-config Desktop Shell (Electron + Tray) | GitHub Releases (.dmg, .exe, .AppImage) |

---

## 🚀 Quick Start

### 1. Terminal UI (TUI)

```bash
# Run directly with npx
npx @dsh-community/tui --model deepseek-reasoner

# Or install globally
npm install -g @dsh-community/tui
dsh-tui
```

**Key Commands inside TUI:**
- `/sessions` - List past sessions from `~/.dsh/sessions`
- `/resume <id>` - Resume any previous session
- `/save` - Save current session to shared store
- `/rollback [index]` - Rewind conversation turns
- `/fork` - Branch conversation from current turn
- `Esc` - Interrupt current thought/generation

### 2. Desktop Shell

Download the installer for your OS from [GitHub Releases](../../releases):
- **macOS**: `.dmg` (Apple Silicon & Intel)
- **Windows**: `.exe` / `.zip`
- **Linux**: `.AppImage` / `.deb`

---

## 🛠️ Development & Contract Testing

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run unit & contract tests
pnpm run test

# Run contract diff against upstream snapshot
npx tsx scripts/contract-checker.ts
```

---

## 📄 License
MIT © 2026 DeepSeek Harness Community Team
