import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface UpstreamSnapshot {
  version: string;
  observedPlugins: string[];
  cliFlags: {
    web: string[];
    headless: string[];
  };
}

/**
 * Live Dynamic Probe against installed/candidate @deepseek-ai/dsh
 * 
 * Captures real runtime introspection and command surface from official executable.
 */
export function probeOfficialDsh(targetVersion = '0.1.0-rc.6'): UpstreamSnapshot {
  console.log(`📡 Probing official @deepseek-ai/dsh@${targetVersion}...`);

  // 1. Probe web profile plugins via dump-default-config
  let observedPlugins: string[] = [];
  try {
    const rawDump = execSync(
      `npx -y @deepseek-ai/dsh@${targetVersion} --profile web --dump-default-config`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const matches = rawDump.matchAll(/name:\s*['"](@deepseek-ai\/[^'"]+)['"]/g);
    for (const m of matches) {
      if (m[1]) observedPlugins.push(m[1]);
    }
  } catch (err: any) {
    console.warn(`⚠️ Failed to dump profile config: ${err.message}`);
  }

  // 2. Probe CLI surfaces
  let webFlags: string[] = [];
  let headlessFlags: string[] = [];
  try {
    const webHelp = execSync(
      `npx -y @deepseek-ai/dsh@${targetVersion} web --help`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const flagMatches = webHelp.matchAll(/--[a-zA-Z0-9-]+/g);
    for (const f of flagMatches) {
      if (!webFlags.includes(f[0])) webFlags.push(f[0]);
    }
  } catch {
    // Ignore
  }

  try {
    const headlessHelp = execSync(
      `npx -y @deepseek-ai/dsh@${targetVersion} --profile headless --help`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const flagMatches = headlessHelp.matchAll(/--[a-zA-Z0-9-]+/g);
    for (const f of flagMatches) {
      if (!headlessFlags.includes(f[0])) headlessFlags.push(f[0]);
    }
  } catch {
    // Ignore
  }

  return {
    version: targetVersion,
    observedPlugins: Array.from(new Set(observedPlugins)),
    cliFlags: {
      web: webFlags,
      headless: headlessFlags,
    },
  };
}

export function runContractDiff(candidateSnapshot?: UpstreamSnapshot): boolean {
  const currentSnapshotPath = path.join(rootDir, 'contracts/upstream/events.snapshot.json');

  console.log(`\n======================================================`);
  console.log(`🔍 Upstream Dynamic Contract Compatibility Checker`);
  console.log(`======================================================\n`);

  // If candidate is not passed in, actively PROBE upstream!
  const target = candidateSnapshot || probeOfficialDsh('0.1.0-rc.6');

  console.log(`📌 Candidate Version: ${target.version}`);
  console.log(`📊 Observed Plugins: ${target.observedPlugins.length}`);
  console.log(`🔌 Web CLI Flags: ${target.cliFlags.web.join(', ')}`);
  console.log(`⚡ Headless Flags: ${target.cliFlags.headless.join(', ')}\n`);

  // Invariants that MUST be satisfied by official runtime
  const REQUIRED_PLUGINS = [
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-llm',
  ];

  let hasBreaking = false;

  for (const req of REQUIRED_PLUGINS) {
    if (!target.observedPlugins.includes(req)) {
      console.error(`❌ [BREAKING] Required upstream plugin missing: ${req}`);
      hasBreaking = true;
    }
  }

  if (!target.cliFlags.web.includes('--port') && !target.cliFlags.web.includes('-h')) {
    console.error(`❌ [BREAKING] Official "web" command lost expected flags (--port)`);
    hasBreaking = true;
  }

  if (hasBreaking) {
    console.error(`\n💥 Compatibility check FAILED. Upstream breaking changes detected!`);
    return false;
  }

  console.log(`✅ Dynamic Contract check PASSED. All baseline runtime seams are satisfied.`);
  return true;
}

// Direct execution
if (process.argv[1] === __filename) {
  const ok = runContractDiff();
  if (!ok) process.exit(1);
}
