import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

interface UpstreamSnapshot {
  version: string;
  events: string[];
  publicMethods: Record<string, string[]>;
}

interface CompatibilityMatrix {
  latestTestedVersion: string;
  versions: Record<string, any>;
}

export function runContractDiff(candidateSnapshot?: UpstreamSnapshot) {
  const currentSnapshotPath = path.join(rootDir, 'contracts/upstream/events.snapshot.json');
  const matrixPath = path.join(rootDir, 'contracts/compatibility/matrix.json');

  if (!fs.existsSync(currentSnapshotPath)) {
    throw new Error('Baseline contract snapshot not found at contracts/upstream/events.snapshot.json');
  }

  const baseline: UpstreamSnapshot = JSON.parse(fs.readFileSync(currentSnapshotPath, 'utf-8'));
  const matrix: CompatibilityMatrix = JSON.parse(fs.readFileSync(matrixPath, 'utf-8'));

  console.log(`\n======================================================`);
  console.log(`🔍 Upstream Contract Compatibility Checker`);
  console.log(`📌 Pinned Tested Baseline: ${baseline.version}`);
  console.log(`======================================================\n`);

  const target = candidateSnapshot || baseline;

  const missingEvents = baseline.events.filter((e) => !target.events.includes(e));
  const newEvents = target.events.filter((e) => !baseline.events.includes(e));

  let hasBreaking = false;

  if (missingEvents.length > 0) {
    console.error(`❌ [BREAKING] Missing upstream events:`);
    for (const e of missingEvents) {
      console.error(`   - ${e}`);
    }
    hasBreaking = true;
  }

  if (newEvents.length > 0) {
    console.log(`✨ [INFO] New upstream events detected:`);
    for (const e of newEvents) {
      console.log(`   + ${e}`);
    }
  }

  // Check public methods
  for (const [domain, methods] of Object.entries(baseline.publicMethods)) {
    const targetMethods = target.publicMethods?.[domain] || [];
    const missingMethods = methods.filter((m) => !targetMethods.includes(m));
    if (missingMethods.length > 0) {
      console.error(`❌ [BREAKING] Missing public methods on domain "${domain}":`);
      for (const m of missingMethods) {
        console.error(`   - ${m}`);
      }
      hasBreaking = true;
    }
  }

  if (hasBreaking) {
    console.error(`\n💥 Compatibility check FAILED. Upstream breaking changes detected!`);
    return false;
  }

  console.log(`✅ Contract check PASSED. All baseline seams and events are satisfied.`);
  return true;
}

// Direct execution
if (process.argv[1] === __filename) {
  const ok = runContractDiff();
  if (!ok) process.exit(1);
}
