import type { 
  DshSession, 
  DshMessage, 
  DshApprovalDecision, 
  DshConfig,
  DshAgentStatus 
} from '../types/index.js';
import { DshEventStream } from '../events/event-stream.js';

export interface AgentControllerOptions {
  config: DshConfig;
  events?: DshEventStream;
}

/**
 * High-Level Agent Controller Facade
 * 
 * Provides an anti-corruption interface for executing turns, handling approvals,
 * managing session forks/rollbacks, and controlling the agent loop.
 */
export class DshAgentController {
  public readonly events: DshEventStream;
  private config: DshConfig;
  private currentSession: DshSession | null = null;
  private currentStatus: DshAgentStatus = 'idle';
  private pendingApprovals = new Map<string, (decision: DshApprovalDecision) => void>();

  constructor(options: AgentControllerOptions) {
    this.config = options.config;
    this.events = options.events || new DshEventStream();

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
  }

  /**
   * Respond to a pending approval request (e.g. tool execution permission)
   */
  public respondApproval(approvalId: string, decision: DshApprovalDecision): void {
    const resolver = this.pendingApprovals.get(approvalId);
    if (resolver) {
      resolver(decision);
      this.pendingApprovals.delete(approvalId);
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
}
