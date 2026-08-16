#!/usr/bin/env bash
#
# DeepSeek Harness Suite (DSH-Suite) One-Line Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/kamanager2012/deepseek-harness-suite/main/install.sh | bash
#

set -e

echo ""
echo "⚡ DeepSeek Harness Community Suite (DSH-Suite) Installer"
echo "=========================================================="
echo ""

# 1. Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required but not installed."
  echo "   Please install Node.js (v20+ or v22 LTS) from: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️ Warning: Node.js version $(node -v) detected. We recommend v20+ or v22 LTS."
fi

# 2. Check for npm
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm is required but not installed."
  exit 1
fi

echo "📦 Installing @dsh-community/tui globally via npm..."
npm install -g @dsh-community/tui

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 Quick Start:"
echo "   dsh-tui                # Launch DeepSeek Harness Terminal UI"
echo "   dsh-tui -r last        # Resume your most recent session"
echo "   dsh-tui --help         # Show available CLI options"
echo ""
