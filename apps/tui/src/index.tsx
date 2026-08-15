#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { DshAgentController } from '@dsh-community/dsh-bridge';
import { App } from './App.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let model = process.env.DEEPSEEK_MODEL || 'deepseek-reasoner';
  let workspacePath = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
DeepSeek Harness TUI (dsh-tui) - Claude Code level Terminal UX

Usage:
  dsh-tui [options]

Options:
  --model <model>       Model to use (default: deepseek-reasoner or $DEEPSEEK_MODEL)
  --dir <path>          Workspace directory (default: current working directory)
  -h, --help            Show this help message
  -v, --version         Show version information

In-session Commands:
  /sessions             List past sessions stored in ~/.dsh/sessions
  /resume <id>          Resume a past session
  /save                 Save current session to shared store
  /rollback [index]     Rewind conversation turns
  /fork                 Branch conversation from current turn
  /exit, /quit          Exit TUI
      `);
      process.exit(0);
    } else if (args[i] === '--version' || args[i] === '-v') {
      console.log('dsh-tui v0.1.0 (@dsh-community/tui)');
      process.exit(0);
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      workspacePath = args[i + 1];
      i++;
    }
  }

  return { model, workspacePath };
}

async function main() {
  const { model, workspacePath } = parseArgs();

  const controller = new DshAgentController({
    config: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model,
      workspacePath,
    },
  });

  const { waitUntilExit } = render(<App controller={controller} />);
  await waitUntilExit();
}

main().catch((err) => {
  console.error('Fatal TUI error:', err);
  process.exit(1);
});
