import { describe, it, expect, vi } from 'vitest';
import { DshEventStream } from '../../src/events/event-stream.js';
import { DshAgentController } from '../../src/agent/agent-controller.js';
import { DshSubprocessManager } from '../../src/runtime/subprocess-manager.js';
import { DshContextGuard } from '../../src/agent/context-guard.js';
import type { DshEvent } from '../../src/types/index.js';

describe('DSH Bridge Contract Tests', () => {
  describe('Event Normalization & Projection', () => {
    it('normalizes streaming reasoning/thought events correctly', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      // Simulate raw upstream DSH reasoning chunk
      stream.projectRawUpstreamEvent({
        type: 'agent.thought',
        delta: 'Analyzing the repository...',
        content: 'Analyzing the repository...',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'stream:reasoning',
        delta: 'Analyzing the repository...',
        fullContent: 'Analyzing the repository...',
      });
    });

    it('normalizes tool requests and auto-detects approval requirements', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      stream.projectRawUpstreamEvent({
        type: 'tool.call',
        id: 'call_123',
        name: 'bash_execute',
        args: { command: 'rm -rf /tmp/test' },
        requiresApproval: true,
        riskLevel: 'high',
      });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('tool:requested');
      expect(events[1].type).toBe('tool:approval_needed');
      if (events[1].type === 'tool:approval_needed') {
        expect(events[1].approval.riskLevel).toBe('high');
        expect(events[1].approval.toolCall.name).toBe('bash_execute');
      }
    });

    it('normalizes TPS and token usage metrics', () => {
      const stream = new DshEventStream();
      let capturedMetrics: any = null;

      stream.on('stream:metrics', (e) => {
        capturedMetrics = e.metrics;
      });

      stream.projectRawUpstreamEvent({
        type: 'metrics.update',
        prompt_tokens: 1500,
        completion_tokens: 300,
        total_tokens: 1800,
        tokens_per_second: 48.5,
        contextLimit: 128000,
        contextUsagePercent: 1.4,
      });

      expect(capturedMetrics).toEqual({
        promptTokens: 1500,
        completionTokens: 300,
        totalTokens: 1800,
        tps: 48.5,
        contextLimit: 128000,
        contextUsagePercent: 1.4,
      });
    });
  });

  describe('Agent Controller State Machine', () => {
    it('manages prompt submission and status transitions', async () => {
      const controller = new DshAgentController({
        config: { model: 'deepseek-chat' },
      });

      expect(controller.getStatus()).toBe('idle');
      expect(controller.getSession().messages).toHaveLength(0);

      await controller.submitPrompt('Refactor the desktop client');

      expect(controller.getStatus()).toBe('thinking');
      expect(controller.getSession().messages).toHaveLength(1);
      expect(controller.getSession().messages[0].content).toBe('Refactor the desktop client');
    });

    it('handles interactive approval resolution', async () => {
      const controller = new DshAgentController({ config: {} });

      const approvalPromise = controller.registerApproval('appr_999');
      controller.respondApproval('appr_999', 'allow_once');

      const result = await approvalPromise;
      expect(result).toBe('allow_once');
    });

    it('supports Esc-like rewind and session forking without mutating old state', async () => {
      const controller = new DshAgentController({ config: {} });
      const session = controller.getSession();

      session.messages.push(
        { id: '1', role: 'user', content: 'First', timestamp: 1, status: 'complete' },
        { id: '2', role: 'assistant', content: 'Reply 1', timestamp: 2, status: 'complete' },
        { id: '3', role: 'user', content: 'Second', timestamp: 3, status: 'complete' }
      );

      // Fork at turn 2 (keeps first user + assistant)
      const forkedSession = controller.forkSession(2);

      expect(forkedSession.messages).toHaveLength(2);
      expect(forkedSession.messages[1].content).toBe('Reply 1');
      expect(forkedSession.id).not.toBe(session.id);
    });
  });

  describe('Subprocess Manager Port Detection', () => {
    it('finds an open port correctly', async () => {
      const manager = new DshSubprocessManager({ config: {} });
      const port = await manager.findAvailablePort(45000);
      expect(port).toBeGreaterThanOrEqual(45000);
      expect(typeof port).toBe('number');
    });
  });

  describe('Context Overflow Guard & Compaction Advisor', () => {
    it('evaluates normal, warning, and critical context thresholds', () => {
      const guard = new DshContextGuard(75, 90);

      // Normal
      const normal = guard.evaluate({
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        tps: 30,
        contextLimit: 128000,
        contextUsagePercent: 0.9,
      });
      expect(normal.isWarning).toBe(false);
      expect(normal.recommendation).toBe('normal');

      // Warning at 80%
      const warning = guard.evaluate({
        promptTokens: 80000,
        completionTokens: 22400,
        totalTokens: 102400,
        tps: 40,
        contextLimit: 128000,
        contextUsagePercent: 80.0,
      });
      expect(warning.isWarning).toBe(true);
      expect(warning.isCritical).toBe(false);
      expect(warning.recommendation).toBe('compact_history');

      // Critical at 95%
      const critical = guard.evaluate({
        promptTokens: 100000,
        completionTokens: 21600,
        totalTokens: 121600,
        tps: 20,
        contextLimit: 128000,
        contextUsagePercent: 95.0,
      });
      expect(critical.isCritical).toBe(true);
      expect(critical.recommendation).toBe('fork_session');
    });
  });
});
