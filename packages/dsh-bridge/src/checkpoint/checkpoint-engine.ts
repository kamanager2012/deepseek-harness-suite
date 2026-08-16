import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface FileSnapshot {
  filePath: string;
  existed: boolean;
  content?: string;
}

export interface CheckpointRecord {
  id: string;
  seq: number;
  timestamp: number;
  description: string;
  snapshots: FileSnapshot[];
}

/**
 * Checkpoint & Safe File Undo Engine
 * 
 * Inspired by aios-core and governor-core state rollback designs.
 * Captures file pre-images before tool write/replace operations, allowing
 * instant /undo of code modifications.
 */
export class DshCheckpointEngine {
  private checkpoints: CheckpointRecord[] = [];
  private baseDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.dsh', 'checkpoints');
    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Snapshot one or more files before a tool mutates them
   */
  public snapshot(filePaths: string[], description: string): CheckpointRecord {
    const seq = this.checkpoints.length + 1;
    const id = `cp_${Date.now()}_${seq}`;
    const snapshots: FileSnapshot[] = [];

    for (const rawPath of filePaths) {
      const fullPath = path.resolve(rawPath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          snapshots.push({ filePath: fullPath, existed: true, content });
        } catch {
          // Ignore binary or inaccessible files
        }
      } else {
        snapshots.push({ filePath: fullPath, existed: false });
      }
    }

    const record: CheckpointRecord = {
      id,
      seq,
      timestamp: Date.now(),
      description,
      snapshots,
    };

    this.checkpoints.push(record);
    return record;
  }

  /**
   * Revert files to the state before the latest (or specified) checkpoint
   */
  public undo(seq?: number): { success: boolean; revertedFiles: string[]; error?: string } {
    if (this.checkpoints.length === 0) {
      return { success: false, revertedFiles: [], error: 'No checkpoints available to undo.' };
    }

    const targetIndex = seq !== undefined
      ? this.checkpoints.findIndex((c) => c.seq === seq)
      : this.checkpoints.length - 1;

    if (targetIndex === -1) {
      return { success: false, revertedFiles: [], error: `Checkpoint seq #${seq} not found.` };
    }

    const checkpoint = this.checkpoints[targetIndex];
    const revertedFiles: string[] = [];

    for (const snap of checkpoint.snapshots) {
      try {
        if (snap.existed && snap.content !== undefined) {
          const dir = path.dirname(snap.filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(snap.filePath, snap.content, 'utf-8');
          revertedFiles.push(snap.filePath);
        } else if (!snap.existed && fs.existsSync(snap.filePath)) {
          fs.unlinkSync(snap.filePath);
          revertedFiles.push(`${snap.filePath} (removed newly created file)`);
        }
      } catch (err: any) {
        return { success: false, revertedFiles, error: `Failed to restore ${snap.filePath}: ${err.message}` };
      }
    }

    // Remove restored checkpoint and any subsequent ones
    this.checkpoints.splice(targetIndex, 1);

    return { success: true, revertedFiles };
  }

  public getCheckpoints(): readonly CheckpointRecord[] {
    return this.checkpoints;
  }
}
