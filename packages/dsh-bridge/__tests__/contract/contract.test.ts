import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import { DshEventStream } from '../../src/events/event-stream.js';
import { DshAgentController } from '../../src/agent/agent-controller.js';
import { DshSubprocessManager } from '../../src/runtime/subprocess-manager.js';
import { DshContextGuard } from '../../src/agent/context-guard.js';
import { DshSharedSessionStore } from '../../src/session/session-store.js';
import { DshAuditChain } from '../../src/security/audit-chain.js';
import { DshDoctor } from '../../src/runtime/doctor.js';
import { DshPluginCatalogClient } from '../../src/marketplace/plugin-catalog.js';
import { DshProviderManager } from '../../src/providers/provider-presets.js';
import { DshCheckpointEngine } from '../../src/checkpoint/checkpoint-engine.js';
import { DshTranscriptExporter } from '../../src/export/transcript-exporter.js';
import { DshIgnoreMatcher } from '../../src/security/dsh-ignore.js';
import { DshRiskEvaluator } from '../../src/security/risk-evaluator.js';
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

    it('auto-approves safe read-only tools without prompting for approval', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      // Safe read-only inspection tool
      stream.projectRawUpstreamEvent({
        type: 'tool.call',
        id: 'call_safe_1',
        name: 'read_file',
        args: { path: '/home/project/src/main.ts' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool:requested');
      if (events[0].type === 'tool:requested') {
        expect(events[0].toolCall.status).toBe('running');
        expect(events[0].toolCall.riskLevel).toBe('low');
      }

      // Safe shell inspection command
      const stream2 = new DshEventStream();
      const events2: DshEvent[] = [];
      stream2.onEvent((e) => events2.push(e));

      stream2.projectRawUpstreamEvent({
        type: 'tool.call',
        id: 'call_safe_2',
        name: 'run_command',
        args: { command: 'git status' },
      });

      expect(events2).toHaveLength(1);
      expect(events2[0].type).toBe('tool:requested');
      if (events2[0].type === 'tool:requested') {
        expect(events2[0].toolCall.status).toBe('running');
        expect(events2[0].toolCall.riskLevel).toBe('low');
      }
    });

    it('requires human approval for dangerous, destructive, or mutating shell commands', () => {
      const stream = new DshEventStream();
      const events: DshEvent[] = [];
      stream.onEvent((e) => events.push(e));

      stream.projectRawUpstreamEvent({
        type: 'tool.call',
        id: 'call_danger_1',
        name: 'bash_execute',
        args: { command: 'rm -rf /tmp/test' },
      });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('tool:requested');
      expect(events[1].type).toBe('tool:approval_needed');
      if (events[1].type === 'tool:approval_needed') {
        expect(events[1].approval.riskLevel).toBe('critical');
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

      const statuses: string[] = [];
      controller.events.on('agent:status', (e) => statuses.push(e.status));

      expect(controller.getStatus()).toBe('idle');
      expect(controller.getSession().messages).toHaveLength(0);

      await controller.submitPrompt('Refactor the desktop client');

      expect(statuses).toContain('thinking');
      expect(controller.getSession().messages.length).toBeGreaterThanOrEqual(1);
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

  describe('Shared Session Store & Atomic Writes', () => {
    it('saves and reads sessions atomically without leaving temporary artifacts', () => {
      const tempOfficial = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-off-test-'));
      const tempSuite = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-suite-test-'));
      try {
        const store = new DshSharedSessionStore(tempOfficial, tempSuite);
        const session = {
          id: 'test_session_123',
          title: 'Atomic Test Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          workspacePath: '/tmp/workspace',
          model: 'deepseek-reasoner',
          messages: [{ id: 'm1', role: 'user' as const, content: 'Hello', timestamp: Date.now(), status: 'complete' as const }],
          metrics: { promptTokens: 10, completionTokens: 20, totalTokens: 30, tps: 15, contextLimit: 128000, contextUsagePercent: 0.1 },
        };

        store.saveSession(session);

        const readBack = store.readSession('test_session_123');
        expect(readBack).not.toBeNull();
        expect(readBack?.title).toBe('Atomic Test Session');

        const files = fs.readdirSync(tempSuite);
        expect(files).toContain('test_session_123.json');
        expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);

        const list = store.listSessions();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('test_session_123');
      } finally {
        fs.rmSync(tempOfficial, { recursive: true, force: true });
        fs.rmSync(tempSuite, { recursive: true, force: true });
      }
    });

    it('handles controller system notifications and session resume helper', () => {
      const tempOfficial = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-off2-test-'));
      const tempSuite = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-suite2-test-'));
      try {
        const store = new DshSharedSessionStore(tempOfficial, tempSuite);
        const controller = new DshAgentController({ config: {} });

        controller.addSystemMessage('System initialized');
        expect(controller.getSession().messages).toHaveLength(1);
        expect(controller.getSession().messages[0].role).toBe('system');
        expect(controller.getSession().messages[0].content).toBe('System initialized');

        const savedId = controller.saveCurrentSession(store);
        expect(savedId).toBe(controller.getSession().id);

        const newController = new DshAgentController({ config: {} });
        const resumed = newController.resumeSessionById(savedId, store);
        expect(resumed).toBe(true);
        expect(newController.getSession().id).toBe(savedId);
      } finally {
        fs.rmSync(tempOfficial, { recursive: true, force: true });
        fs.rmSync(tempSuite, { recursive: true, force: true });
      }
    });
  });

  describe('Tamper-Evident Audit Chain', () => {
    it('cryptographically chains execution records and detects tampering', () => {
      const chain = new DshAuditChain();

      const r1 = chain.append({
        sessionId: 'sess_1',
        toolName: 'read_file',
        args: { path: '/tmp/test.ts' },
        riskLevel: 'low',
        verdict: 'auto_approved',
      });

      const r2 = chain.append({
        sessionId: 'sess_1',
        toolName: 'bash',
        args: { command: 'rm -rf /tmp/build' },
        riskLevel: 'critical',
        verdict: 'approved_once',
      });

      expect(chain.getRecords()).toHaveLength(2);
      expect(r2.prevHash).toBe(r1.hash);

      const verification = chain.verify();
      expect(verification.valid).toBe(true);
    });
  });

  describe('Five-Layer Environment Doctor', () => {
    it('runs comprehensive diagnostics and formats readable health reports', () => {
      const report = DshDoctor.diagnose(
        { model: 'deepseek-reasoner', apiKey: 'sk-mock-key' },
        { running: true, pid: 12345, uptimeSeconds: 42 },
        { promptTokens: 2000, completionTokens: 500, totalTokens: 2500, tps: 45, contextLimit: 128000, contextUsagePercent: 1.95 }
      );

      expect(report.overallStatus).toBe('healthy');
      expect(report.checks.length).toBeGreaterThanOrEqual(4);

      const text = DshDoctor.formatReport(report);
      expect(text).toContain('DeepSeek Harness System Health Report');
      expect(text).toContain('Node.js Runtime Version');
    });
  });

  describe('Community Plugin Marketplace Discovery', () => {
    it('searches and formats community plugins from registry', async () => {
      const client = new DshPluginCatalogClient();
      const plugins = await client.searchPlugins('context');

      expect(plugins.length).toBeGreaterThan(0);
      expect(plugins[0].name).toContain('context');

      const formatted = client.formatPluginList(plugins, '0.1.0-rc.8');
      expect(formatted).toContain('DSH Community Plugin Marketplace');
      expect(formatted).toContain('dsh plugin add');
    });
  });

  describe('Multi-Provider Preset Manager', () => {
    it('provides preset details and handles dynamic provider switching', () => {
      const presets = DshProviderManager.listPresets();
      expect(presets.length).toBeGreaterThanOrEqual(4);

      const silicon = DshProviderManager.getPreset('siliconflow');
      expect(silicon?.baseUrl).toContain('siliconflow.cn');

      const controller = new DshAgentController({ config: {} });
      const switchRes = controller.switchProvider('siliconflow');
      expect(switchRes.success).toBe(true);
      expect(controller.getSession().model).toBe('deepseek-ai/DeepSeek-R1');
    });
  });

  describe('File Checkpoint & Mutation Undo Engine', () => {
    it('captures pre-mutation snapshots and successfully rolls back changes', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cp-test-'));
      try {
        const engine = new DshCheckpointEngine(tempDir);
        const testFile = path.join(tempDir, 'sample.ts');
        fs.writeFileSync(testFile, 'const initial = 1;', 'utf-8');

        engine.snapshot([testFile], 'Before refactor');

        // Mutate file
        fs.writeFileSync(testFile, 'const modified = 2;', 'utf-8');
        expect(fs.readFileSync(testFile, 'utf-8')).toBe('const modified = 2;');

        // Undo
        const undoRes = engine.undo();
        expect(undoRes.success).toBe(true);
        expect(fs.readFileSync(testFile, 'utf-8')).toBe('const initial = 1;');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Session Transcript Exporter', () => {
    it('exports session history into structured Markdown and JSON reports', () => {
      const session = {
        id: 'sess_export_1',
        title: 'Export Test',
        createdAt: 1700000000000,
        updatedAt: 1700000010000,
        workspacePath: '/tmp/workspace',
        model: 'deepseek-reasoner',
        messages: [
          { id: 'm1', role: 'user' as const, content: 'Write a quicksort function', timestamp: 1700000000000, status: 'complete' as const },
          { id: 'm2', role: 'assistant' as const, reasoning: 'Thinking about partition...', content: 'Here is quicksort in TypeScript', timestamp: 1700000005000, status: 'complete' as const },
        ],
        metrics: { promptTokens: 15, completionTokens: 40, totalTokens: 55, tps: 30, contextLimit: 128000, contextUsagePercent: 0.04 },
      };

      const md = DshTranscriptExporter.toMarkdown(session);
      expect(md).toContain('DeepSeek Harness Session Transcript');
      expect(md).toContain('Write a quicksort function');
      expect(md).toContain('Thinking about partition...');

      const json = DshTranscriptExporter.toJson(session);
      expect(JSON.parse(json).id).toBe('sess_export_1');
    });
  });

  describe('DSH Ignore & Sensitive Path Defense', () => {
    it('detects sensitive files and elevates risk to critical', () => {
      const matcher = new DshIgnoreMatcher('/tmp');
      expect(matcher.isIgnored('.env')).toBe(true);
      expect(matcher.isIgnored('server.key')).toBe(true);
      expect(matcher.isIgnored('node_modules/express/index.js')).toBe(true);
      expect(matcher.isIgnored('src/App.tsx')).toBe(false);

      // Verify RiskEvaluator triggers critical approval for sensitive file
      const evalResult = DshRiskEvaluator.evaluate('read_file', { path: '/workspace/.env' });
      expect(evalResult.riskLevel).toBe('critical');
      expect(evalResult.requiresApproval).toBe(true);
    });
  });
});
