import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DshSession, DshMessage } from '../types/index.js';

export interface DshSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  model: string;
  filePath: string;
}

/**
 * Shared Session Store Adapter
 * 
 * Interacts directly with the official single-source-of-truth ~/.dsh/sessions directory.
 * Ensures TUI, Desktop, and official DSH Web UI share the exact same session state.
 */
export class DshSharedSessionStore {
  private sessionsDir: string;
  private watcher: fs.FSWatcher | null = null;

  constructor(customDir?: string) {
    this.sessionsDir = customDir || path.join(os.homedir(), '.dsh', 'sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  public getDirectory(): string {
    return this.sessionsDir;
  }

  /**
   * List all sessions found in ~/.dsh/sessions
   */
  public listSessions(): DshSessionSummary[] {
    if (!fs.existsSync(this.sessionsDir)) return [];

    const files = fs.readdirSync(this.sessionsDir);
    const summaries: DshSessionSummary[] = [];

    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.jsonl')) {
        const fullPath = path.join(this.sessionsDir, file);
        try {
          const stats = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const id = path.basename(file, path.extname(file));

          let title = `Session ${id.slice(0, 8)}`;
          let messageCount = 0;
          let model = 'deepseek-reasoner';

          if (file.endsWith('.json')) {
            const data = JSON.parse(content);
            title = data.title || title;
            messageCount = data.messages?.length || 0;
            model = data.model || model;
          } else {
            // JSONL format
            const lines = content.trim().split('\n').filter(Boolean);
            messageCount = lines.length;
            if (lines.length > 0) {
              const first = JSON.parse(lines[0]);
              if (first.title) title = first.title;
              if (first.model) model = first.model;
            }
          }

          summaries.push({
            id,
            title,
            updatedAt: stats.mtimeMs,
            messageCount,
            model,
            filePath: fullPath,
          });
        } catch {
          // ignore corrupted files
        }
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Read full session by ID
   */
  public readSession(sessionId: string): DshSession | null {
    const jsonPath = path.join(this.sessionsDir, `${sessionId}.json`);
    const jsonlPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);

    if (fs.existsSync(jsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      } catch {
        return null;
      }
    }

    if (fs.existsSync(jsonlPath)) {
      try {
        const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean);
        const messages: DshMessage[] = [];
        let title = `Session ${sessionId}`;
        let model = 'deepseek-reasoner';

        for (const line of lines) {
          const entry = JSON.parse(line);
          if (entry.type === 'session:meta') {
            title = entry.title || title;
            model = entry.model || model;
          } else if (entry.role && entry.content) {
            messages.push(entry);
          }
        }

        return {
          id: sessionId,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          workspacePath: process.cwd(),
          model,
          messages,
          metrics: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            tps: 0,
            contextLimit: 128000,
            contextUsagePercent: 0,
          },
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Save session to ~/.dsh/sessions in standard format
   */
  public saveSession(session: DshSession): void {
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Watch ~/.dsh/sessions for changes from other frontends (TUI / Web)
   */
  public watch(onChange: (event: 'change' | 'rename', filename: string | null) => void): () => void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    this.watcher = fs.watch(this.sessionsDir, (eventType, filename) => {
      onChange(eventType, filename);
    });

    return () => {
      if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
      }
    };
  }
}
