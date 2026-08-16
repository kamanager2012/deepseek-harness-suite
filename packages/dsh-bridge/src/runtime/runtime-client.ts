import { 
  DeepSeekHarness, 
  type RunResult, 
  type HarnessNotification 
} from '@deepseek-ai/dsh-sdk-client';
import { spawn, type ChildProcess } from 'node:child_process';
import { DshEventStream } from '../events/event-stream.js';
import type { DshConfig, DshToolCall } from '../types/index.js';

export interface RuntimeExecutionOptions {
  prompt: string;
  config: DshConfig;
  events: DshEventStream;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface RuntimeExecutionResult {
  content: string;
  reasoning?: string;
  sessionId?: string;
  toolCalls?: DshToolCall[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  executionMode?: 'sdk_jsonrpc' | 'headless_cli';
}

/**
 * Official DSH Runtime Execution Client (over @deepseek-ai/dsh-sdk-client)
 * 
 * Drives DeepSeek Harness runtime subprocess over stdio JSON-RPC using the
 * official TypeScript SDK client, normalizing wire notifications and events
 * into the DshEventStream.
 */
export class DshRuntimeClient {
  private activeHarness: DeepSeekHarness | null = null;
  private fallbackProcess: ChildProcess | null = null;

  /**
   * Execute prompt turn through official JSON-RPC SDK or fallback CLI
   */
  public async executeTurn(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    const { prompt, config, events, sessionId, signal } = options;

    events.emitEvent({
      type: 'agent:status',
      status: 'thinking',
    });

    try {
      // 1. Primary path: Official @deepseek-ai/dsh-sdk-client stdio JSON-RPC
      const harness = new DeepSeekHarness({
        launch: {
          command: 'npx',
          args: ['-y', `@deepseek-ai/dsh@${config.runtimeVersion || '0.1.0-rc.6'}`, '--profile', 'jsonrpc-agent'],
          cwd: config.workspacePath || process.cwd(),
          env: {
            ...process.env,
            DEEPSEEK_API_KEY: config.apiKey || process.env.DEEPSEEK_API_KEY,
            DEEPSEEK_BASE_URL: config.baseUrl || process.env.DEEPSEEK_BASE_URL,
          },
          requestTimeoutMs: 120000,
        },
        cwd: config.workspacePath || process.cwd(),
        provider: config.provider || 'deepseek-official',
        model: config.model || 'deepseek-reasoner',
        maxTokens: config.maxTokens,
      });

      this.activeHarness = harness;

      if (signal) {
        signal.addEventListener('abort', () => {
          this.interrupt();
        });
      }

      let accumulatedContent = '';
      let accumulatedReasoning = '';
      const toolCalls: DshToolCall[] = [];

      const result: RunResult = await harness.run(prompt, {
        sessionId,
        onNotification: (notif: HarnessNotification) => {
          // Normalize official SessionEvent notifications from runtime
          if (notif.method === 'session.event' || notif.method === 'session/event') {
            const ev = (notif.params?.event || notif.params) as any;
            const eventType = String(ev?.type || '');

            // 1. Streaming Assistant Chunks
            if (eventType === 'assistant/chunk' || eventType === 'agent:thought' || eventType === 'reasoning') {
              const delta = String(ev.delta || ev.content || '');
              if (ev.isReasoning || eventType.includes('thought') || eventType.includes('reasoning')) {
                accumulatedReasoning += delta;
                events.emitEvent({
                  type: 'stream:reasoning',
                  delta,
                  fullContent: accumulatedReasoning,
                });
              } else {
                accumulatedContent += delta;
                events.emitEvent({
                  type: 'agent:status',
                  status: 'generating',
                });
                events.emitEvent({
                  type: 'stream:content',
                  delta,
                  fullContent: accumulatedContent,
                });
              }
            } else if (eventType === 'assistant/message' || eventType === 'agent:message') {
              const text = String(ev.content || ev.text || '');
              if (text && !accumulatedContent.includes(text)) {
                accumulatedContent += text;
              }
            }

            // 2. Official Tool Call Events
            if (eventType === 'tool/call' || eventType === 'tool.call') {
              const call: DshToolCall = {
                id: ev.id || `call_${Date.now()}`,
                name: ev.name || ev.tool || 'unknown_tool',
                args: ev.args || {},
                status: 'running',
                riskLevel: 'medium',
                startedAt: Date.now(),
              };
              toolCalls.push(call);
              events.emitEvent({
                type: 'tool:requested',
                toolCall: call,
              });
            } else if (eventType === 'tool/result' || eventType === 'tool.result') {
              const callId = ev.id || ev.callId || 'unknown';
              const target = toolCalls.find(c => c.id === callId);
              const toolStatus = ev.error ? 'failed' : 'success';
              if (target) {
                target.status = toolStatus;
                target.output = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result || {});
                target.completedAt = Date.now();
              }
              events.emitEvent({
                type: 'tool:output',
                toolCallId: callId,
                output: typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result || {}),
              });
              events.emitEvent({
                type: 'tool:finished',
                toolCallId: callId,
                status: toolStatus,
                output: typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result || {}),
                error: ev.error ? String(ev.error) : undefined,
              });
            }

            // 3. Official Approval Events
            if (eventType === 'approval/asked' || eventType === 'approval.asked') {
              events.emitEvent({
                type: 'tool:approval_needed',
                approval: {
                  id: ev.id || `appr_${Date.now()}`,
                  toolCall: {
                    id: ev.toolCallId || ev.id,
                    name: ev.tool || 'unknown',
                    args: ev.args || {},
                    status: 'pending_approval',
                    riskLevel: 'high',
                    startedAt: Date.now(),
                  },
                  riskLevel: 'high',
                  promptMessage: ev.message || `Approval required for tool ${ev.tool}`,
                  timestamp: Date.now(),
                },
              });
            }
          }
        },
      });

      events.emitEvent({
        type: 'agent:status',
        status: 'idle',
      });

      const finalResponseText = result.finalResponse || accumulatedContent;

      return {
        content: finalResponseText.trim(),
        reasoning: accumulatedReasoning.trim() || undefined,
        sessionId: result.sessionId,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        executionMode: 'sdk_jsonrpc',
      };
    } catch (sdkErr: any) {
      // Log explicit fallback so caller is aware of execution mode
      events.emitEvent({
        type: 'error',
        message: `SDK stdio JSON-RPC unavailable (${sdkErr.message}), switching to headless profile execution.`,
      });

      // 2. Fallback execution path: headless profile subprocess runner
      return this.executeHeadlessFallback(options);
    } finally {
      if (this.activeHarness) {
        try {
          await this.activeHarness.close();
        } catch {
          // Ignore close errors
        }
        this.activeHarness = null;
      }
    }
  }

  /**
   * Headless CLI fallback for environments where jsonrpc-agent profile is not initialized
   */
  private async executeHeadlessFallback(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    const { prompt, config, events, signal } = options;

    return new Promise<RuntimeExecutionResult>((resolve, reject) => {
      let accumulatedContent = '';
      let accumulatedReasoning = '';

      const child = spawn('npx', ['-y', `@deepseek-ai/dsh@${config.runtimeVersion || '0.1.0-rc.6'}`, '--profile', 'headless', prompt], {
        cwd: config.workspacePath || process.cwd(),
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: config.apiKey || process.env.DEEPSEEK_API_KEY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.fallbackProcess = child;

      if (signal) {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        });
      }

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        accumulatedContent += text;
        events.emitEvent({
          type: 'stream:content',
          delta: text,
          fullContent: accumulatedContent,
        });
      });

      child.on('error', (err) => {
        events.emitEvent({
          type: 'agent:status',
          status: 'error',
          payload: { error: err.message },
        });
        reject(err);
      });

      child.on('close', (code) => {
        this.fallbackProcess = null;
        if (code !== 0 && code !== null) {
          const errorMsg = `Official DSH headless process exited with failure code ${code}`;
          events.emitEvent({
            type: 'agent:status',
            status: 'error',
            payload: { error: errorMsg },
          });
          reject(new Error(errorMsg));
          return;
        }

        events.emitEvent({
          type: 'agent:status',
          status: 'idle',
        });

        resolve({
          content: accumulatedContent.trim(),
          reasoning: accumulatedReasoning.trim() || undefined,
          executionMode: 'headless_cli',
        });
      });
    });
  }

  /**
   * Interrupt runtime execution through official SDK shutdown ladder or SIGTERM
   */
  public interrupt(): void {
    if (this.activeHarness) {
      this.activeHarness.close().catch(() => {});
      this.activeHarness = null;
    }
    if (this.fallbackProcess) {
      this.fallbackProcess.kill('SIGTERM');
      this.fallbackProcess = null;
    }
  }
}
