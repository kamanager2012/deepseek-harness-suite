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

      const result: RunResult = await harness.run(prompt, {
        sessionId,
        onNotification: (notif: HarnessNotification) => {
          // Normalize JSON-RPC notifications from official runtime
          if (notif.method === 'session/event' || notif.method === 'session.event') {
            const params = notif.params as any;
            if (params?.type === 'agent:thought' || params?.type === 'reasoning') {
              const delta = String(params.delta || params.content || '');
              accumulatedReasoning += delta;
              events.emitEvent({
                type: 'stream:reasoning',
                delta,
                fullContent: accumulatedReasoning,
              });
            } else if (params?.type === 'agent:message' || params?.type === 'content') {
              const delta = String(params.delta || params.content || '');
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
      };
    } catch (sdkErr: any) {
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

      child.on('close', () => {
        this.fallbackProcess = null;
        events.emitEvent({
          type: 'agent:status',
          status: 'idle',
        });

        resolve({
          content: accumulatedContent.trim(),
          reasoning: accumulatedReasoning.trim() || undefined,
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
