import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DshSharedSessionStore } from '../../packages/dsh-bridge/src/session/session-store.js';
import type { DshSession } from '../../packages/dsh-bridge/src/types/index.js';

describe('Shared Session Store Single-Source-of-Truth Contracts', () => {
  let tempDir: string;
  let store: DshSharedSessionStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-test-'));
    store = new DshSharedSessionStore(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('saves and lists sessions in ~/.dsh/sessions format', () => {
    const session: DshSession = {
      id: 'sess_12345',
      title: 'Refactor Auth Pipeline',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspacePath: '/projects/demo',
      model: 'deepseek-reasoner',
      messages: [
        { id: 'm1', role: 'user', content: 'Help me refactor auth', timestamp: Date.now(), status: 'complete' },
        { id: 'm2', role: 'assistant', content: 'Sure, let us analyze...', timestamp: Date.now(), status: 'complete' }
      ],
      metrics: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        tps: 35,
        contextLimit: 128000,
        contextUsagePercent: 0.1,
      },
    };

    store.saveSession(session);

    const summaries = store.listSessions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('sess_12345');
    expect(summaries[0].title).toBe('Refactor Auth Pipeline');
    expect(summaries[0].messageCount).toBe(2);

    const loaded = store.readSession('sess_12345');
    expect(loaded).not.toBeNull();
    expect(loaded?.messages).toHaveLength(2);
  });

  it('parses official JSONL session logs', () => {
    const jsonlContent = [
      JSON.stringify({ type: 'session:meta', title: 'Official DSH Log', model: 'deepseek-chat' }),
      JSON.stringify({ role: 'user', content: 'Hello world' }),
      JSON.stringify({ role: 'assistant', content: 'Hi there!' }),
    ].join('\n');

    fs.writeFileSync(path.join(tempDir, 'sess_jsonl_999.jsonl'), jsonlContent, 'utf-8');

    const summaries = store.listSessions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('sess_jsonl_999');
    expect(summaries[0].title).toBe('Official DSH Log');

    const session = store.readSession('sess_jsonl_999');
    expect(session?.messages).toHaveLength(2);
    expect(session?.messages[0].content).toBe('Hello world');
  });
});
