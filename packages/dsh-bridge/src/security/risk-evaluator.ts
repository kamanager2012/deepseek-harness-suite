import type { RiskLevel } from '../types/index.js';
import { DshIgnoreMatcher } from './dsh-ignore.js';

export type ToolCapability =
  | 'fs:read'
  | 'fs:write'
  | 'fs:delete'
  | 'process:exec'
  | 'process:kill'
  | 'net:read'
  | 'net:write'
  | 'credential:read'
  | 'git:write'
  | 'system:mutate';

export interface ToolRiskEvaluation {
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  capabilities: ToolCapability[];
  reason: string;
}

const CRITICAL_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force|--force\s+--recursive)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|poweroff|init\s+0)\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\bgit\s+push\s+.*(--force|-f)\b/i,
  /\b(drop\s+database|drop\s+table)\b/i,
  /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};\s*:/, // Fork bomb
  /\bcurl\s+.*\|\s*(sh|bash)\b/i,       // Remote script execution pipe
  /\bwget\s+.*\|\s*(sh|bash)\b/i,
];

const KNOWN_SAFE_READ_TOOLS: Record<string, ToolCapability[]> = {
  'read_file': ['fs:read'],
  'view_file': ['fs:read'],
  'list_dir': ['fs:read'],
  'grep_search': ['fs:read'],
  'search_web': ['net:read'],
  'read_url_content': ['net:read'],
  'get_health': ['fs:read'],
  'list_sessions': ['fs:read'],
  'contract_checker': ['process:exec'],
};

const SAFE_SHELL_COMMAND_PREFIXES = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'ls',
  'pwd',
  'cat ',
  'head ',
  'tail ',
  'echo ',
  'which ',
  'node -v',
  'pnpm -v',
  'npm -v',
  'tsc --noEmit',
  'pnpm test',
  'vitest run',
  'tsx scripts/',
];

/**
 * Capability-Driven Tool Risk & Policy Evaluator
 * 
 * Replaces naive string-prefix matching with true capability semantics:
 * - Maps tool operations to fine-grained capabilities (fs:read, fs:write, process:exec, credential:read).
 * - Enforces credential and sensitive path protection (.dshignore).
 * - Dissects command lines for destructive, irreversible, or privileged side-effects.
 */
export class DshRiskEvaluator {
  /**
   * Infer capabilities from tool name and argument semantics
   */
  public static inferCapabilities(name: string, args: Record<string, unknown>): ToolCapability[] {
    const normalized = (name || '').toLowerCase().trim();

    // 1. Check known explicit tool map
    if (KNOWN_SAFE_READ_TOOLS[normalized]) {
      return [...KNOWN_SAFE_READ_TOOLS[normalized]];
    }

    const caps = new Set<ToolCapability>();

    // 2. Destructive keyword check overrides any safe-sounding prefix
    if (
      normalized.includes('delete') ||
      normalized.includes('remove') ||
      normalized.includes('unlink') ||
      normalized.includes('destroy') ||
      normalized.includes('drop') ||
      normalized.includes('erase') ||
      normalized.includes('purge')
    ) {
      caps.add('fs:delete');
      caps.add('system:mutate');
    }

    // 3. Credential exposure check
    if (
      normalized.includes('password') ||
      normalized.includes('secret') ||
      normalized.includes('credential') ||
      normalized.includes('token') ||
      normalized.includes('key')
    ) {
      caps.add('credential:read');
    }

    // 4. Process execution check
    if (
      normalized.includes('bash') ||
      normalized.includes('exec') ||
      normalized.includes('shell') ||
      normalized.includes('terminal') ||
      normalized.includes('command') ||
      normalized.includes('spawn')
    ) {
      caps.add('process:exec');
    }

    // 5. Process termination
    if (normalized.includes('kill') || normalized.includes('terminate') || normalized.includes('abort')) {
      caps.add('process:kill');
    }

    // 6. File writing / replacing
    if (
      normalized.includes('write') ||
      normalized.includes('replace') ||
      normalized.includes('edit') ||
      normalized.includes('modify') ||
      normalized.includes('append')
    ) {
      caps.add('fs:write');
    }

    // 7. Network operations
    if (normalized.includes('fetch') || normalized.includes('http') || normalized.includes('download') || normalized.includes('curl')) {
      caps.add('net:read');
    }

    // Default to fs:read if no other capability is inferred
    if (caps.size === 0) {
      caps.add('fs:read');
    }

    return Array.from(caps);
  }

  /**
   * Evaluate risk level and approval requirement based on capability semantics
   */
  public static evaluate(
    name: string,
    args: Record<string, unknown> = {},
    explicitRequiresApproval?: boolean,
    policy: 'auto_safe' | 'strict' | 'unrestricted' = 'auto_safe'
  ): ToolRiskEvaluation {
    const capabilities = this.inferCapabilities(name, args);

    // 1. Unrestricted policy override
    if (policy === 'unrestricted') {
      return {
        riskLevel: 'low',
        requiresApproval: false,
        capabilities,
        reason: 'Auto-approved by unrestricted policy',
      };
    }

    // 2. Strict policy override
    if (policy === 'strict') {
      return {
        riskLevel: 'high',
        requiresApproval: true,
        capabilities,
        reason: 'Human approval required by strict policy',
      };
    }

    // 3. Sensitive file and credential protection check
    const targetFile = String(args.path || args.targetFile || args.filePath || args.file_path || args.TargetFile || '');
    if (targetFile) {
      const matcher = new DshIgnoreMatcher();
      if (matcher.isIgnored(targetFile)) {
        return {
          riskLevel: 'critical',
          requiresApproval: true,
          capabilities: [...capabilities, 'credential:read'],
          reason: `Protected sensitive path detected (.dshignore): "${targetFile}"`,
        };
      }
    }

    // 4. Process execution & command inspection
    const commandStr = String(args.command || args.cmd || args.script || args.CommandLine || '');
    if (commandStr) {
      for (const pattern of CRITICAL_COMMAND_PATTERNS) {
        if (pattern.test(commandStr)) {
          return {
            riskLevel: 'critical',
            requiresApproval: true,
            capabilities: [...capabilities, 'system:mutate'],
            reason: `Destructive command pattern detected: ${pattern.source}`,
          };
        }
      }

      // Check if command matches known safe read-only CLI prefixes
      const trimmed = commandStr.trim();
      if (SAFE_SHELL_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
        return {
          riskLevel: 'low',
          requiresApproval: false,
          capabilities: ['fs:read'],
          reason: `Safe read-only inspection command: "${trimmed.slice(0, 35)}"`,
        };
      }

      // Arbitrary non-whitelisted command requires approval
      return {
        riskLevel: 'high',
        requiresApproval: true,
        capabilities: ['process:exec'],
        reason: `Arbitrary shell command execution: "${trimmed.slice(0, 35)}"`,
      };
    }

    // 5. Capability-driven risk classification
    if (capabilities.includes('credential:read') || capabilities.includes('system:mutate')) {
      return {
        riskLevel: 'critical',
        requiresApproval: true,
        capabilities,
        reason: `High-privilege capability requested: ${capabilities.join(', ')}`,
      };
    }

    if (capabilities.includes('fs:delete') || capabilities.includes('process:kill')) {
      return {
        riskLevel: 'high',
        requiresApproval: true,
        capabilities,
        reason: `Destructive capability requested: ${capabilities.join(', ')}`,
      };
    }

    if (capabilities.includes('fs:write') || capabilities.includes('git:write')) {
      return {
        riskLevel: 'medium',
        requiresApproval: Boolean(explicitRequiresApproval),
        capabilities,
        reason: `State-modifying write capability: ${capabilities.join(', ')}`,
      };
    }

    // Pure read-only tools
    return {
      riskLevel: 'low',
      requiresApproval: Boolean(explicitRequiresApproval),
      capabilities,
      reason: `Safe inspection capability: ${capabilities.join(', ')}`,
    };
  }
}
