import { EventEmitter } from 'node:events';
import type { DshEvent, DshAgentStatus, DshApprovalRequest, DshToolCall, DshUsageMetrics } from '../types/index.js';
import { DshRiskEvaluator } from '../security/risk-evaluator.js';

export type DshEventListener<T extends DshEvent = DshEvent> = (event: T) => void;

/**
 * Reactive Event Bus providing standardized event streams for TUI and Desktop.
 */
export class DshEventStream {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /**
   * Subscribe to all normalized events
   */
  public onEvent(listener: DshEventListener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  /**
   * Subscribe to specific event types
   */
  public on<K extends DshEvent['type']>(
    type: K,
    listener: (event: Extract<DshEvent, { type: K }>) => void
  ): () => void {
    const wrapped = (event: DshEvent) => {
      if (event.type === type) {
        listener(event as Extract<DshEvent, { type: K }>);
      }
    };
    this.emitter.on('event', wrapped);
    return () => this.emitter.off('event', wrapped);
  }

  /**
   * Emit a normalized DshEvent
   */
  public emitEvent(event: DshEvent): void {
    this.emitter.emit('event', event);
    this.emitter.emit(event.type, event);
  }

  /**
   * Project raw upstream @deepseek-ai/dsh events into clean normalized events.
   * Isolates upstream schema changes to this single transformer method.
   */
  public projectRawUpstreamEvent(rawEvent: Record<string, any>): void {
    if (!rawEvent || typeof rawEvent !== 'object') return;

    const rawType = rawEvent.type || rawEvent.event;

    switch (rawType) {
      case 'agent.thought':
      case 'reasoning_content':
      case 'stream:thought': {
        const delta = rawEvent.delta || rawEvent.chunk || '';
        const full = rawEvent.content || rawEvent.text || '';
        this.emitEvent({
          type: 'stream:reasoning',
          delta,
          fullContent: full,
        });
        break;
      }

      case 'agent.message':
      case 'content':
      case 'stream:content': {
        const delta = rawEvent.delta || rawEvent.chunk || '';
        const full = rawEvent.content || rawEvent.text || '';
        this.emitEvent({
          type: 'stream:content',
          delta,
          fullContent: full,
        });
        break;
      }

      case 'metrics.update':
      case 'usage': {
        const metrics: Partial<DshUsageMetrics> = {
          promptTokens: rawEvent.promptTokens ?? rawEvent.prompt_tokens,
          completionTokens: rawEvent.completionTokens ?? rawEvent.completion_tokens,
          totalTokens: rawEvent.totalTokens ?? rawEvent.total_tokens,
          tps: rawEvent.tps ?? rawEvent.tokens_per_second ?? 0,
          contextLimit: rawEvent.contextLimit ?? 128000,
          contextUsagePercent: rawEvent.contextUsagePercent ?? 0,
        };
        this.emitEvent({
          type: 'stream:metrics',
          metrics,
        });
        break;
      }

      case 'tool.call':
      case 'tool.invoke': {
        const name = rawEvent.name || rawEvent.tool || 'unknown_tool';
        const args = rawEvent.args || rawEvent.arguments || {};
        const explicitApproval = rawEvent.requiresApproval;

        // Auto-approve safe read-only operations; require approval for destructive or high-risk tasks
        const evaluation = DshRiskEvaluator.evaluate(name, args, explicitApproval, (rawEvent.approvalPolicy || 'auto_safe'));
        const riskLevel = rawEvent.riskLevel || evaluation.riskLevel;
        const requiresApproval = evaluation.requiresApproval;

        const toolCall: DshToolCall = {
          id: rawEvent.id || String(Date.now()),
          name,
          args,
          status: requiresApproval ? 'pending_approval' : 'running',
          riskLevel,
          diff: rawEvent.diff,
          startedAt: Date.now(),
        };

        this.emitEvent({
          type: 'tool:requested',
          toolCall,
        });

        if (requiresApproval) {
          const approval: DshApprovalRequest = {
            id: `appr_${toolCall.id}`,
            toolCall,
            promptMessage: rawEvent.promptMessage || `Approve tool execution: ${toolCall.name}${evaluation.reason ? ` (${evaluation.reason})` : ''}`,
            riskLevel: toolCall.riskLevel,
            timestamp: Date.now(),
          };
          this.emitEvent({
            type: 'tool:approval_needed',
            approval,
          });
        }
        break;
      }

      case 'tool.result':
      case 'tool.finish': {
        const toolCallId = rawEvent.id || rawEvent.toolCallId;
        const status = rawEvent.error ? 'failed' : 'success';
        this.emitEvent({
          type: 'tool:finished',
          toolCallId,
          status,
          output: rawEvent.output || rawEvent.result,
          error: rawEvent.error,
        });
        break;
      }

      case 'agent.state':
      case 'status': {
        let status: DshAgentStatus = 'idle';
        const rawStatus = String(rawEvent.status || rawEvent.state).toLowerCase();
        if (rawStatus.includes('think')) status = 'thinking';
        else if (rawStatus.includes('gen') || rawStatus.includes('stream')) status = 'generating';
        else if (rawStatus.includes('approv')) status = 'awaiting_approval';
        else if (rawStatus.includes('tool') || rawStatus.includes('exec')) status = 'executing_tool';
        else if (rawStatus.includes('interrupt') || rawStatus.includes('cancel')) status = 'interrupted';
        else if (rawStatus.includes('err')) status = 'error';

        this.emitEvent({
          type: 'agent:status',
          status,
          payload: rawEvent,
        });
        break;
      }

      case 'error': {
        this.emitEvent({
          type: 'error',
          message: rawEvent.message || 'Unknown runtime error',
          code: rawEvent.code,
          fatal: rawEvent.fatal ?? false,
        });
        break;
      }

      default:
        // Pass through raw event under a generic wrapper if needed
        break;
    }
  }

  public removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
