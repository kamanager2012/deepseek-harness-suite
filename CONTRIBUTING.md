# Contributing to DeepSeek Harness Community Suite (DSH-Suite)

Thank you for your interest in contributing to DSH-Suite!

## 🏛️ Core Architectural Invariants

Before submitting code, please ensure your changes respect our **6 Non-Negotiable Architectural Rules**:

1. **Official Source Ownership = 0**: Never vendor `@deepseek-ai/dsh` source code or monorepo packages into this repository. It must remain an external runtime dependency.
2. **Minimal Patch Surface**: TUI Cordis patches must never override official core rows (`llm-deepseek`, `agent-loop`, `session-persistence`, `approval-core`).
3. **Session Single-Source-of-Truth**: All sessions must remain interoperable with `~/.dsh/sessions/`.
4. **Subprocess Isolation**: Desktop acts as a process manager. `stdout/stderr` is strictly for diagnostic logs, not business state protocols.
5. **Contract CI Gate**: All PRs must pass `npx tsx scripts/contract-checker.ts`.

---

## 🛠️ Local Development & Testing

```bash
# 1. Install dependencies
pnpm install

# 2. Build all workspaces
pnpm run build

# 3. Run full test suite
pnpm run test

# 4. Run upstream contract compatibility check
npx tsx scripts/contract-checker.ts
```

---

## 📦 Proposing Support for a New Upstream DSH Version

1. Update `contracts/upstream/events.snapshot.json` if new public events were introduced.
2. Update `contracts/compatibility/matrix.json` with the new tested version status.
3. Run `npx tsx scripts/contract-checker.ts` and ensure all tests pass.
4. Submit your PR!
