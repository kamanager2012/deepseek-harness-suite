# DeepSeek Harness 社区套件 (DSH-Suite)

> ⚡ **以官方运行时为核心（Official-Runtime Centric）** 的 DeepSeek Harness 终端 TUI 与桌面客户端增强套件。

[English](./README.md) | **简体中文**

[![Contract CI](https://github.com/kamanager2012/deepseek-harness-suite/actions/workflows/contract-ci.yml/badge.svg)](https://github.com/kamanager2012/deepseek-harness-suite/actions/workflows/contract-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![官方基准验证: 0.1.0-rc.6](https://img.shields.io/badge/Official%20DSH-0.1.0--rc.6%20verified-green.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)

---

## 🎯 架构设计与真实性声明（Reality Gate）

我们坚持 **“Official Source Ownership = 0”** 原则，绝不 Fork 或魔改官方仓库源码，将官方发布包 `@deepseek-ai/dsh` 作为独立外部运行时进行受控调度。

| 模块 / 能力 | 真实状态 | 事实与实现依据 |
| :--- | :--- | :--- |
| **官方零源码侵入** | `[REAL]` | 零魔改，直接通过 `npx @deepseek-ai/dsh@0.1.0-rc.6` 进程拉起驱动。 |
| **桌面受控浏览器壳** | `[REAL]` | Electron 宿主 + 官方 `dsh web` 本地进程 + 托盘常驻与生命周期管控。 |
| **跨平台进程树治理** | `[REAL]` | POSIX 独立进程组分离 + Windows 树杀（3080 端口 0 残留、0 僵尸进程）。 |
| **动态契约 CI 探针** | `[REAL]` | 真实调用官方命令动态采集 128 个插件行与 CLI flags，防止上游破坏性变更。 |
| **终端极客视觉组件** | `[REAL]` | `DiffViewer`（行级红绿高亮）、`ReasoningBox`（R1 推理思维折叠）、`ToolCard`。 |
| **智能免审批引擎** | `[REAL]` | `DshRiskEvaluator` 白名单秒放行只读探查，拦截并弹窗高危破坏指令。 |
| **运行时调用通道** | `[REAL]` | `DshRuntimeClient` 已接通真实 Headless 子进程并流式归一化推理事件。 |
| **敏感与巨大目录防御** | `[REAL]` | `.dshignore` 引擎自动拦截 `.env`、密钥与 `node_modules` 避免被 AI 误读误改。 |
| **会话存储安全隔离** | `[READ-SAFE]` | 官方 `~/.dsh/sessions` 严格只读；Suite 自建状态安全隔离在 `~/.dsh/suite_sessions/`。 |
| **回滚与分叉** | `[UI-LEVEL]` | 标明当前为消息历史回退（`/rollback`），待官方 runtime 开放状态回滚 API。 |

---

## 🚀 极速上手

### 1. 终端版 (TUI)

```bash
# 无需安装，直接运行体验
npx @dsh-community/tui --model deepseek-reasoner

# 或全局安装使用快捷命令
npm install -g @dsh-community/tui
dsh-tui

# 极速接续上一轮任务
dsh-tui -r last
```

#### ⌨️ 常用终端指令表

* `/doctor` - 运行五层架构全身系统与环境体检（Node版本、API状态、端口、Token预算）
* `/plugins [关键词]` - 检索官方与社区插件注册表（`dsh-community-plugins`）
* `/audit` - 查看密码学 SHA-256 不可篡改的操作审计历史
* `/provider switch <id>` - 热切换模型服务商（`deepseek`、`siliconflow`、`volcengine`、`ollama`、`vllm`）
* `/undo` - 撤回上一步被 AI 修改或新建的文件快照
* `/export [markdown|json]` - 一键导出美观的 Markdown 或 JSON 会话报告
* `/sessions` - 浏览所有历史会话（包含官方会话与 Suite 会话）
* `/resume <id>` - 接续指定 ID 的会话
* `/save` - 原子保存当前会话
* `Esc` - 立即打断当前思考或生成

---

### 2. 桌面版 (Desktop)

从 [GitHub Releases](../../releases) 下载对应平台的安装包：
- **macOS**: `.dmg` (支持 Apple Silicon M系列与 Intel)
- **Windows**: `.exe` / 便携免安装 `.zip`
- **Linux**: `.AppImage` / `.deb`

---

## 📖 实战指南与最佳实践 (Cookbook)

### 场景一：连接本地私有化 Ollama（100% 离线，零数据外流）
1. 启动本地 Ollama 实例并拉取 DeepSeek-R1：
   ```bash
   ollama run deepseek-r1:14b
   ```
2. 在 TUI 中直接切换到本地预设：
   ```text
   > /provider switch ollama deepseek-r1:14b
   ```

### 场景二：代码重构与安全防线
1. 执行 `/doctor` 确认工作区健康度；
2. 开启自动免审批模式，安全执行 `git status`、`ls`、`read_file` 零弹窗打扰；
3. 若 AI 提出的修改不符合预期，直接输入 `/undo`，秒级恢复受影响文件。

---

## 🩺 常见故障排查 (Troubleshooting)

| 症状 / 报错 | 原因分析 | 解决方案 |
| :--- | :--- | :--- |
| `端口 3080 被占用` | 此前第三方软件残留了官方 Node 孤儿进程 | Suite Desktop 启动时会自动避让并寻找新可用端口；或执行 `killall node`。 |
| `401 Unauthorized` | 环境变量未正确设置 API Key | 执行 `export DEEPSEEK_API_KEY="sk-..."` 或在启动时传入。 |
| `Context window > 90%` | 对话过长即将耗尽 128k 上下文 | 系统触发红色告警，推荐输入 `/fork` 创建新分支会话。 |
| `Protected path detected` | AI 尝试读取 `.env` 或私钥文件 | `.dshignore` 主动拦截，需用户明确审批后方可访问。 |

---

## 🛠️ 本地开发与契约测试

```bash
# 1. 安装依赖
pnpm install

# 2. 全量构建
pnpm run build

# 3. 运行单元与契约测试 (22 项全部通过)
pnpm run test

# 4. 运行上游真实动态探针
npx tsx scripts/contract-checker.ts
```

---

## 📄 开源协议
MIT © 2026 DeepSeek Harness Community Team
