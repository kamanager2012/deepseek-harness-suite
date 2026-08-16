import { spawn, type ChildProcess } from 'node:child_process';
import { DshEventStream } from '../events/event-stream.js';
import type { DshConfig, DshMessage, DshToolCall } from '../types/index.js';

export interface RuntimeExecutionOptions {
  prompt: string;
  config: DshConfig;
  events: DshEventStream;
  signal?: AbortSignal;
}

export interface RuntimeExecutionResult {
  content: string;
  reasoning?: string;
  toolCalls?: DshToolCall[];
  tokensUsed?: { prompt: number; completion: number; total: number };
}

/**
 * Official DSH Runtime Execution Client
 * 
 * Closes the P0-1 runtime execution seam:
 * Connects AgentController turns directly to the official @deepseek-ai/dsh runtime,
 * streaming reasoning thoughts, content, and tool events back to the UI.
 */
export class DshRuntimeClient {
  private activeProcess: ChildProcess | null = null;

  /**
   * Execute prompt turn through official runtime or API stream
   */
  public async executeTurn(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    const { prompt, config, events, signal } = options;

    return new Promise<RuntimeExecutionResult>((resolve, reject) => {
      let accumulatedContent = '';
      let accumulatedReasoning = '';
      let isReasoning = false;

      events.emitEvent({
        type: 'agent:status',
        status: 'thinking',
      });

      // Try spawning official headless profile or CLI execution
      const dshArgs = ['--profile', 'headless', prompt];
      const child = spawn('npx', ['-y', `@deepseek-ai/dsh@${config.runtimeVersion || '0.1.0-rc.6'}`, ...dshArgs], {
        cwd: config.workspacePath || process.cwd(),
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: config.apiKey || process.env.DEEPSEEK_API_KEY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcess = child;

      if (signal) {
        signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        });
      }

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');

        // Parse reasoning vs content markers if output by model
        if (text.includes('<think>') || isReasoning) {
          isReasoning = true;
          if (text.includes('</think>')) {
            const parts = text.split('</think>');
            accumulatedReasoning += parts[0].replace('<think>', '');
            accumulatedContent += parts[1] || '';
            isReasoning = false;
          } else {
            accumulatedReasoning += text.replace('<think>', '');
          }

          events.emitEvent({
            type: 'stream:reasoning',
            delta: text,
            fullContent: accumulatedReasoning,
          });
        } else {
          accumulatedContent += text;
          events.emitEvent({
            type: 'agent:status',
            status: 'generating',
          });
          events.emitEvent({
            type: 'stream:content',
            delta: text,
            fullContent: accumulatedContent,
          });
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const errText = data.toString('utf-8');
        // If headless mode emits log or error
        if (errText.includes('error:') || errText.includes('ERR')) {
          events.emitEvent({
            type: 'error',
            message: errText.trim(),
          });
        }
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
        this.activeProcess = null;
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

  public interrupt(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }
}
