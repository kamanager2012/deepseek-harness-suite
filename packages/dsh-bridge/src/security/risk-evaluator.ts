import type { RiskLevel } from '../types/index.js';
import { DshIgnoreMatcher } from './dsh-ignore.js';

export interface ToolRiskEvaluation {
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  reason?: string;
}

const SAFE_TOOL_PREFIXES = [
  'read_',
  'view_',
  'list_',
  'get_',
  'search_',
  'grep_',
  'glob_',
  'find_',
  'fetch_',
  'query_',
  'check_',
  'inspect_',
];

const SAFE_TOOL_NAMES = new Set([
  'read_file',
  'view_file',
  'list_dir',
  'grep_search',
  'search_web',
  'read_url_content',
  'get_health',
  'list_sessions',
  'contract_checker',
  'check_contracts',
  'find_files',
  'file_search',
]);

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
];

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
 * Intelligent Tool Risk & Approval Policy Evaluator
 * 
 * Auto-approves all non-destructive, read-only, and safe inspection operations,
 * reserving human-in-the-loop approval strictly for dangerous or state-altering actions.
 */
export class DshRiskEvaluator {
  /**
   * Evaluate whether a tool call is safe to auto-execute or requires approval
   */
  public static evaluate(
    name: string,
    args: Record<string, unknown> = {},
    explicitRequiresApproval?: boolean,
    policy: 'auto_safe' | 'strict' | 'unrestricted' = 'auto_safe'
  ): ToolRiskEvaluation {
    const normalizedName = (name || '').toLowerCase().trim();

    // 1. Unrestricted policy: allow everything without approval
    if (policy === 'unrestricted') {
      const risk = this.calculateRisk(normalizedName, args);
      return {
        riskLevel: risk,
        requiresApproval: false,
        reason: 'Auto-approved by unrestricted policy',
      };
    }

    // 2. Strict policy: ask approval for all tools
    if (policy === 'strict') {
      const risk = this.calculateRisk(normalizedName, args);
      return {
        riskLevel: risk,
        requiresApproval: true,
        reason: 'Approval required by strict policy',
      };
    }

    // 3. Auto-Safe policy (Default):
    // Check if target file is a protected/ignored or sensitive file (.env, keys, etc.)
    const targetFile = String(args.path || args.targetFile || args.filePath || args.file_path || args.TargetFile || '');
    if (targetFile) {
      const matcher = new DshIgnoreMatcher();
      if (matcher.isIgnored(targetFile)) {
        return {
          riskLevel: 'critical',
          requiresApproval: true,
          reason: `Protected path detected in .dshignore/sensitive list: "${targetFile}"`,
        };
      }
    }

    // Check if command contains critical destructive actions
    const commandStr = String(args.command || args.cmd || args.script || args.CommandLine || '');
    if (commandStr) {
      for (const pattern of CRITICAL_COMMAND_PATTERNS) {
        if (pattern.test(commandStr)) {
          return {
            riskLevel: 'critical',
            requiresApproval: true,
            reason: `Critical risk detected: matching destructive command pattern (${pattern.source})`,
          };
        }
      }

      // Check if command is an explicit safe read-only shell command
      const trimmedCmd = commandStr.trim();
      const isSafeCommand = SAFE_SHELL_COMMAND_PREFIXES.some(prefix => trimmedCmd.startsWith(prefix));
      if (isSafeCommand) {
        return {
          riskLevel: 'low',
          requiresApproval: false,
          reason: `Safe read-only command detected: "${trimmedCmd.slice(0, 30)}"`,
        };
      }
    }

    // Check if tool name is safe read-only
    if (
      SAFE_TOOL_NAMES.has(normalizedName) ||
      SAFE_TOOL_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
    ) {
      return {
        riskLevel: 'low',
        requiresApproval: false,
        reason: `Safe read-only inspection tool: ${normalizedName}`,
      };
    }

    // High risk tools (arbitrary bash, terminal execution, process kill)
    if (
      normalizedName.includes('bash') ||
      normalizedName.includes('exec') ||
      normalizedName.includes('shell') ||
      normalizedName.includes('terminal') ||
      normalizedName.includes('kill') ||
      normalizedName.includes('spawn')
    ) {
      return {
        riskLevel: 'high',
        requiresApproval: true,
        reason: `High risk tool execution: ${normalizedName}`,
      };
    }

    // Mutating write tools
    if (
      normalizedName.includes('write') ||
      normalizedName.includes('replace') ||
      normalizedName.includes('edit') ||
      normalizedName.includes('delete') ||
      normalizedName.includes('modify') ||
      normalizedName.includes('remove')
    ) {
      // If it's a file write/replace, medium risk. If upstream explicitly asked or strict, require approval.
      const isDelete = normalizedName.includes('delete') || normalizedName.includes('remove');
      return {
        riskLevel: isDelete ? 'high' : 'medium',
        requiresApproval: isDelete || Boolean(explicitRequiresApproval),
        reason: isDelete ? `Destructive deletion action: ${normalizedName}` : `File modification: ${normalizedName}`,
      };
    }

    // Fallback: If upstream explicitly flagged approval, honor it; otherwise low-medium
    const requiresApproval = explicitRequiresApproval ?? false;
    return {
      riskLevel: requiresApproval ? 'medium' : 'low',
      requiresApproval,
      reason: requiresApproval ? 'Upstream flagged approval requirement' : 'Standard tool execution',
    };
  }

  private static calculateRisk(name: string, args: Record<string, unknown>): RiskLevel {
    const commandStr = String(args.command || args.cmd || args.script || args.CommandLine || '');
    if (commandStr) {
      for (const pattern of CRITICAL_COMMAND_PATTERNS) {
        if (pattern.test(commandStr)) return 'critical';
      }
      if (SAFE_SHELL_COMMAND_PREFIXES.some(prefix => commandStr.trim().startsWith(prefix))) {
        return 'low';
      }
      return 'high';
    }

    if (
      SAFE_TOOL_NAMES.has(name) ||
      SAFE_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      return 'low';
    }

    if (
      name.includes('bash') ||
      name.includes('exec') ||
      name.includes('shell') ||
      name.includes('terminal') ||
      name.includes('kill')
    ) {
      return 'high';
    }

    if (name.includes('delete') || name.includes('remove')) {
      return 'high';
    }

    return 'medium';
  }
}
