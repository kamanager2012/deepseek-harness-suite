import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DshSession, DshMessage } from '../types/index.js';

export interface OfficialSessionRef {
  readonly id: string;
  readonly projectKey: string;
  readonly transcriptPath: string;
  readonly mtimeMs: number;
}

export interface DshSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  model: string;
  filePath: string;
  isOfficial?: boolean;
}

/**
 * Session Store Adapter (Read-Safe & Segregated)
 * 
 * Safety Guarantee (P0):
 * 1. Official ~/.dsh/sessions is strictly READ-ONLY to avoid contaminating official runtime records.
 * 2. Suite-specific sessions are isolated in ~/.dsh/suite_sessions with atomic write protection.
 */
export class DshSharedSessionStore {
  private officialSessionsDir: string;
  private suiteSessionsDir: string;

  constructor(customOfficialDir?: string, customSuiteDir?: string) {
    const dshHome = path.join(os.homedir(), '.dsh');
    this.officialSessionsDir = customOfficialDir || path.join(dshHome, 'sessions');
    this.suiteSessionsDir = customSuiteDir || path.join(dshHome, 'suite_sessions');

    if (!fs.existsSync(this.suiteSessionsDir)) {
      try {
        fs.mkdirSync(this.suiteSessionsDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  }

  public getSuiteDirectory(): string {
    return this.suiteSessionsDir;
  }

  public getOfficialDirectory(): string {
    return this.officialSessionsDir;
  }

  /**
   * Discovers official sessions from ~/.dsh/sessions in READ-ONLY mode.
   * Matches official layout: ~/.dsh/sessions/<project>/<sessionId>/session.jsonl(.zstd)
   */
  public listOfficialSessions(): OfficialSessionRef[] {
    if (!fs.existsSync(this.officialSessionsDir)) return [];
    const found: OfficialSessionRef[] = [];

    try {
      const projects = fs.readdirSync(this.officialSessionsDir, { withFileTypes: true });
      for (const proj of projects) {
        if (!proj.isDirectory()) continue;
        const projDir = path.join(this.officialSessionsDir, proj.name);
        const sessions = fs.readdirSync(projDir, { withFileTypes: true });
        for (const sess of sessions) {
          if (!sess.isDirectory()) continue;
          const sessDir = path.join(projDir, sess.name);
          const candidates = ['session.jsonl', 'session.jsonl.zstd'];
          for (const cand of candidates) {
            const transcript = path.join(sessDir, cand);
            if (fs.existsSync(transcript)) {
              found.push({
                id: sess.name,
                projectKey: proj.name,
                transcriptPath: transcript,
                mtimeMs: fs.statSync(transcript).mtimeMs,
              });
              break;
            }
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /**
   * List all Suite-managed sessions from ~/.dsh/suite_sessions
   */
  public listSessions(): DshSessionSummary[] {
    const summaries: DshSessionSummary[] = [];

    if (fs.existsSync(this.suiteSessionsDir)) {
      try {
        const files = fs.readdirSync(this.suiteSessionsDir);
        for (const file of files) {
          if (file.startsWith('.') || !file.endsWith('.json')) continue;
          const fullPath = path.join(this.suiteSessionsDir, file);
          try {
            const stats = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const data = JSON.parse(content);
            summaries.push({
              id: data.id || path.basename(file, '.json'),
              title: data.title || `Session ${file.slice(0, 8)}`,
              updatedAt: data.updatedAt || stats.mtimeMs,
              messageCount: data.messages?.length || 0,
              model: data.model || 'deepseek-reasoner',
              filePath: fullPath,
              isOfficial: false,
            });
          } catch {
            // Ignore parse errors
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Append read-only official sessions as summaries
    const official = this.listOfficialSessions();
    for (const off of official) {
      summaries.push({
        id: off.id,
        title: `Official Session (${off.projectKey})`,
        updatedAt: off.mtimeMs,
        messageCount: 0,
        model: 'official-runtime',
        filePath: off.transcriptPath,
        isOfficial: true,
      });
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Read full session by ID from suite sessions
   */
  public readSession(sessionId: string): DshSession | null {
    const filePath = path.join(this.suiteSessionsDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Save session to ~/.dsh/suite_sessions atomically (Never writes to official ~/.dsh/sessions)
   */
  public saveSession(session: DshSession): void {
    if (!fs.existsSync(this.suiteSessionsDir)) {
      fs.mkdirSync(this.suiteSessionsDir, { recursive: true });
    }
    const targetFile = path.join(this.suiteSessionsDir, `${session.id}.json`);
    const tempFile = path.join(
      this.suiteSessionsDir,
      `.${session.id}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`
    );

    fs.writeFileSync(tempFile, JSON.stringify(session, null, 2), 'utf-8');
    fs.renameSync(tempFile, targetFile);
  }
}
