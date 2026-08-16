import type { 
  DshSession, 
  DshMessage, 
  DshApprovalDecision, 
  DshConfig,
  DshAgentStatus 
} from '../types/index.js';
import { DshEventStream } from '../events/event-stream.js';
import { DshSharedSessionStore } from '../session/session-store.js';
import { DshAuditChain } from '../security/audit-chain.js';
import { DshDoctor, type DoctorReport } from '../runtime/doctor.js';
import { DshPluginCatalogClient, type PluginEntry } from '../marketplace/plugin-catalog.js';
import { DshCheckpointEngine } from '../checkpoint/checkpoint-engine.js';
import { DshProviderManager, type ProviderPreset } from '../providers/provider-presets.js';
import { DshTranscriptExporter } from '../export/transcript-exporter.js';
import { DshRuntimeClient } from '../runtime/runtime-client.js';

export interface AgentControllerOptions {
  config: DshConfig;
  events?: DshEventStream;
  auditChain?: DshAuditChain;
  checkpoints?: DshCheckpointEngine;
  runtimeClient?: DshRuntimeClient;
}

/**
 * High-Level Agent Controller Facade
 * 
 * Provides an anti-corruption interface for executing turns, handling approvals,
 * managing session forks/rollbacks, and controlling the agent loop.
 */
export class DshAgentController {
  public readonly events: DshEventStream;
  public readonly auditChain: DshAuditChain;
  public readonly checkpoints: DshCheckpointEngine;
  public readonly runtimeClient: DshRuntimeClient;
  private pluginClient = new DshPluginCatalogClient();
  private config: DshConfig;
  private currentSession: DshSession | null = null;
  private currentStatus: DshAgentStatus = 'idle';
  private pendingApprovals = new Map<string, (decision: DshApprovalDecision) => void>();

  constructor(options: AgentControllerOptions) {
    this.config = options.config;
    this.events = options.events || new DshEventStream();
    this.auditChain = options.auditChain || new DshAuditChain();
    this.checkpoints = options.checkpoints || new DshCheckpointEngine();
    this.runtimeClient = options.runtimeClient || new DshRuntimeClient();

    this.initSession();
    this.setupInternalListeners();
  }

  private initSession(): void {
    this.currentSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: 'New Workspace Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspacePath: this.config.workspacePath || process.cwd(),
      model: this.config.model || 'deepseek-reasoner',
      messages: [],
      metrics: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tps: 0,
        contextLimit: 128000,
        contextUsagePercent: 0,
      },
    };
  }

  private setupInternalListeners(): void {
    this.events.on('agent:status', (event) => {
      this.currentStatus = event.status;
    });

    this.events.on('stream:metrics', (event) => {
      if (this.currentSession) {
        this.currentSession.metrics = {
          ...this.currentSession.metrics,
          ...event.metrics,
        };
        this.events.emitEvent({
          type: 'session:updated',
          session: this.currentSession,
        });
      }
    });
  }

  public getSession(): DshSession {
    if (!this.currentSession) {
      this.initSession();
    }
    return this.currentSession!;
  }

  public getStatus(): DshAgentStatus {
    return this.currentStatus;
  }

  public updateConfig(newConfig: Partial<DshConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): Readonly<DshConfig> {
    return this.config;
  }

  /**
   * Submit a user prompt to the Agent
   */
  public async submitPrompt(promptText: string): Promise<void> {
    if (this.currentStatus !== 'idle' && this.currentStatus !== 'error') {
      throw new Error(`Cannot submit prompt while agent is in state: ${this.currentStatus}`);
    }

    const session = this.getSession();
    const userMsg: DshMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: promptText,
      timestamp: Date.now(),
      status: 'complete',
    };

    session.messages.push(userMsg);
    session.updatedAt = Date.now();

    this.events.emitEvent({
      type: 'agent:status',
      status: 'thinking',
    });

    this.events.emitEvent({
      type: 'session:updated',
      session,
    });

    try {
      const result = await this.runtimeClient.executeTurn({
        prompt: promptText,
        config: this.config,
        events: this.events,
      });

      if (result.content || result.reasoning) {
        const assistantMsg: DshMessage = {
          id: `msg_a_${Date.now()}`,
          role: 'assistant',
          content: result.content,
          reasoning: result.reasoning,
          reasoningContent: result.reasoning,
          timestamp: Date.now(),
          status: 'complete',
        };

        session.messages.push(assistantMsg);
        session.updatedAt = Date.now();

        this.events.emitEvent({
          type: 'session:updated',
          session,
        });
      }
    } catch (err: any) {
      this.events.emitEvent({
        type: 'agent:status',
        status: 'error',
        payload: { error: err.message },
      });
    }
  }

  /**
   * Respond to a pending approval request (e.g. tool execution permission)
   */
  public respondApproval(approvalId: string, decision: DshApprovalDecision): void {
    const resolver = this.pendingApprovals.get(approvalId);
    if (resolver) {
      resolver(decision);
      this.pendingApprovals.delete(approvalId);
      this.auditChain.append({
        sessionId: this.getSession().id,
        toolName: approvalId,
        args: {},
        riskLevel: 'high',
        verdict: decision === 'allow_once' ? 'approved_once' : decision === 'allow_always' ? 'approved_always' : 'rejected',
        reason: `Human decision: ${decision}`,
        status: decision === 'reject' ? 'failed' : 'success',
      });
    }
  }

  /**
   * Register a pending approval promise
   */
  public registerApproval(approvalId: string): Promise<DshApprovalDecision> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, resolve);
    });
  }

  /**
   * Interrupt / cancel active agent loop
   */
  public interrupt(): void {
    this.runtimeClient.interrupt();
    this.events.emitEvent({
      type: 'agent:status',
      status: 'interrupted',
    });
    // Clear pending approvals with reject
    for (const [id, resolver] of this.pendingApprovals.entries()) {
      resolver('reject');
    }
    this.pendingApprovals.clear();
  }

  /**
   * Rollback the session to a specific turn index (Claude Code style rewind)
   */
  public rollback(turnIndex: number): void {
    const session = this.getSession();
    if (turnIndex < 0 || turnIndex >= session.messages.length) {
      throw new Error(`Invalid turn index for rollback: ${turnIndex}`);
    }

    session.messages = session.messages.slice(0, turnIndex);
    session.updatedAt = Date.now();

    this.events.emitEvent({
      type: 'session:updated',
      session,
    });
  }

  /**
   * Fork session from a specific point into a new session
   */
  public forkSession(atTurnIndex: number): DshSession {
    const oldSession = this.getSession();
    const truncatedMessages = oldSession.messages.slice(0, atTurnIndex);

    const newSession: DshSession = {
      id: `session_fork_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: `Fork of ${oldSession.title}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspacePath: oldSession.workspacePath,
      model: oldSession.model,
      messages: JSON.parse(JSON.stringify(truncatedMessages)),
      metrics: { ...oldSession.metrics },
    };

    this.events.emitEvent({
      type: 'session:forked',
      originalSessionId: oldSession.id,
      newSessionId: newSession.id,
      atTurn: atTurnIndex,
    });

    this.currentSession = newSession;
    this.events.emitEvent({
      type: 'session:updated',
      session: newSession,
    });

    return newSession;
  }

  /**
   * Load and resume an existing session from the shared store
   */
  public loadSession(session: DshSession): void {
    this.currentSession = session;
    this.events.emitEvent({
      type: 'session:updated',
      session: this.currentSession,
    });
  }

  /**
   * Append a system notification/log message to the current session
   */
  public addSystemMessage(content: string): DshMessage {
    const session = this.getSession();
    const sysMsg: DshMessage = {
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'system',
      content,
      timestamp: Date.now(),
      status: 'complete',
    };
    session.messages.push(sysMsg);
    session.updatedAt = Date.now();
    this.events.emitEvent({
      type: 'session:updated',
      session,
    });
    return sysMsg;
  }

  /**
   * Save the active session to the shared session store
   */
  public saveCurrentSession(store?: DshSharedSessionStore): string {
    const sessionStore = store || new DshSharedSessionStore();
    const session = this.getSession();
    sessionStore.saveSession(session);
    this.addSystemMessage(`Session successfully saved to ~/.dsh/sessions/${session.id}.json`);
    return session.id;
  }

  /**
   * Resume an existing session by ID
   */
  public resumeSessionById(sessionId: string, store?: DshSharedSessionStore): boolean {
    const sessionStore = store || new DshSharedSessionStore();
    const loaded = sessionStore.readSession(sessionId);
    if (loaded) {
      this.loadSession(loaded);
      this.addSystemMessage(`Resumed session "${sessionId}" (${loaded.title})`);
      return true;
    }
    this.addSystemMessage(`Session "${sessionId}" not found in ~/.dsh/sessions`);
    return false;
  }

  /**
   * Run full system and environmental health diagnostics (/doctor)
   */
  public diagnose(runtimeHealth?: any): DoctorReport {
    return DshDoctor.diagnose(this.config, runtimeHealth, this.getSession().metrics);
  }

  /**
   * Format doctor diagnostics report as human readable text
   */
  public formatDoctorReport(report: DoctorReport): string {
    return DshDoctor.formatReport(report);
  }

  /**
   * Search community and official plugin catalog
   */
  public async searchPlugins(query = ''): Promise<PluginEntry[]> {
    return this.pluginClient.searchPlugins(query);
  }

  /**
   * Format plugin list for display in TUI
   */
  public formatPluginList(plugins: PluginEntry[]): string {
    return this.pluginClient.formatPluginList(plugins, this.config.runtimeVersion || '0.1.0-rc.8');
  }

  /**
   * Switch model provider preset (/provider switch <id> [model])
   */
  public switchProvider(providerId: string, modelName?: string): { success: boolean; message: string } {
    const preset = DshProviderManager.getPreset(providerId);
    if (!preset) {
      return {
        success: false,
        message: `Unknown provider "${providerId}". Supported: ${Object.keys(DshProviderManager.listPresets()).join(', ')}`,
      };
    }

    const session = this.getSession();
    const targetModel = modelName || preset.defaultModel;
    session.model = targetModel;
    session.metrics = {
      ...session.metrics,
      contextLimit: preset.contextLimit,
    };

    this.events.emitEvent({
      type: 'session:updated',
      session,
    });

    return {
      success: true,
      message: `Switched provider to "${preset.name}" (Model: ${targetModel}, Context Limit: ${(preset.contextLimit / 1024).toFixed(0)}k)`,
    };
  }

  /**
   * List available provider presets
   */
  public listProviders(): string {
    return DshProviderManager.formatPresetsList(this.config.provider || 'deepseek');
  }

  /**
   * Undo the latest file modification checkpoint (/undo)
   */
  public undoLastMutation(): { success: boolean; message: string } {
    const res = this.checkpoints.undo();
    if (!res.success) {
      return { success: false, message: res.error || 'Undo failed.' };
    }

    return {
      success: true,
      message: `Successfully rolled back ${res.revertedFiles.length} file(s):\n` + res.revertedFiles.map((f) => `  • ${f}`).join('\n'),
    };
  }

  /**
   * Export the current session transcript (/export [markdown|json])
   */
  public exportTranscript(format: 'markdown' | 'json' = 'markdown'): string {
    const session = this.getSession();
    if (format === 'json') {
      return DshTranscriptExporter.toJson(session);
    }
    return DshTranscriptExporter.toMarkdown(session);
  }
}
