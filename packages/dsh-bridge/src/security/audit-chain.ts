import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RiskLevel } from '../types/index.js';

export interface AuditRecordPayload {
  seq: number;
  timestamp: number;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  verdict: 'auto_approved' | 'approved_once' | 'approved_always' | 'rejected';
  reason?: string;
  durationMs?: number;
  status?: 'success' | 'failed' | 'pending';
}

export interface ChainedAuditRecord extends AuditRecordPayload {
  prevHash: string;
  hash: string;
}

const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic Tamper-Evident Audit Chain
 * 
 * Cryptographically chains every tool invocation, security judgment,
 * and approval decision using SHA-256 hash chaining (like governor-core / aios-core).
 */
export class DshAuditChain {
  private records: ChainedAuditRecord[] = [];
  private logPath?: string;

  constructor(auditDir?: string, sessionId?: string) {
    if (auditDir || sessionId) {
      const dir = auditDir || path.join(os.homedir(), '.dsh', 'audit');
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          // Ignore
        }
      }
      if (sessionId) {
        this.logPath = path.join(dir, `${sessionId}.audit.jsonl`);
      }
    }
  }

  public append(payload: Omit<AuditRecordPayload, 'seq' | 'timestamp'>): ChainedAuditRecord {
    const seq = this.records.length + 1;
    const timestamp = Date.now();
    const prevHash = this.records.length > 0 ? this.records[this.records.length - 1].hash : GENESIS_HASH;

    const fullPayload: AuditRecordPayload = {
      seq,
      timestamp,
      ...payload,
    };

    const hash = this.calculateHash(fullPayload, prevHash);
    const chainedRecord: ChainedAuditRecord = {
      ...fullPayload,
      prevHash,
      hash,
    };

    this.records.push(chainedRecord);

    if (this.logPath) {
      try {
        fs.appendFileSync(this.logPath, JSON.stringify(chainedRecord) + '\n', 'utf-8');
      } catch {
        // Ignore file errors
      }
    }

    return chainedRecord;
  }

  public verify(): { valid: boolean; brokenAtSeq?: number; error?: string } {
    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];

      if (rec.seq !== i + 1) {
        return { valid: false, brokenAtSeq: rec.seq, error: `Sequence mismatch at index ${i}: expected ${i + 1}, got ${rec.seq}` };
      }

      if (rec.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAtSeq: rec.seq, error: `Hash chain broken at seq ${rec.seq}: prevHash does not match` };
      }

      const calculated = this.calculateHash(rec, expectedPrevHash);
      if (rec.hash !== calculated) {
        return { valid: false, brokenAtSeq: rec.seq, error: `Content altered at seq ${rec.seq}: hash mismatch` };
      }

      expectedPrevHash = rec.hash;
    }

    return { valid: true };
  }

  public getRecords(): readonly ChainedAuditRecord[] {
    return this.records;
  }

  private calculateHash(payload: AuditRecordPayload, prevHash: string): string {
    const content = JSON.stringify({
      seq: payload.seq,
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      toolName: payload.toolName,
      args: payload.args,
      riskLevel: payload.riskLevel,
      verdict: payload.verdict,
      reason: payload.reason,
      prevHash,
    });

    return createHash('sha256').update(content).digest('hex');
  }
}
