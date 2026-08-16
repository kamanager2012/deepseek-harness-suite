import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface FileSnapshot {
  filePath: string;
  relativePath: string;
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
 * Checkpoint & Safe File Undo Engine with Strict Workspace Boundary Jail
 * 
 * Enforces strict workspace containment:
 * - Prevents path traversal (../), symlink escapes, or drive root jumping.
 * - Restricts snapshot and /undo rollback operations strictly within workspaceRoot.
 * - Truncates trailing checkpoints on sequential rollback to prevent invalid state chains.
 */
export class DshCheckpointEngine {
  private checkpoints: CheckpointRecord[] = [];
  private workspaceRoot: string;
  private baseDir: string;
  private maxCheckpoints: number;

  constructor(workspaceRoot?: string, customBaseDir?: string, maxCheckpoints = 50) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.baseDir = customBaseDir || path.join(os.homedir(), '.dsh', 'checkpoints');
    this.maxCheckpoints = maxCheckpoints;

    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch {
        // In restricted environments, fallback to in-memory only
      }
    }
  }

  /**
   * Verify and sanitize that a target path resides strictly inside the workspace boundary.
   * Throws Error if path escapes workspace.
   */
  public sanitizeWorkspacePath(rawPath: string): { fullPath: string; relativePath: string } {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new Error('Invalid file path: path must be a non-empty string.');
    }

    // Check null bytes or control characters
    if (rawPath.includes('\0')) {
      throw new Error(`Security Violation: Null byte detected in path "${rawPath}"`);
    }

    const resolved = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(this.workspaceRoot, rawPath);

    // Canonicalize workspace root
    let canonicalRoot = this.workspaceRoot;
    if (fs.existsSync(this.workspaceRoot)) {
      try {
        canonicalRoot = fs.realpathSync(this.workspaceRoot);
      } catch {
        canonicalRoot = path.resolve(this.workspaceRoot);
      }
    }

    // Check if the file exists to resolve symlinks
    let canonicalTarget = resolved;
    if (fs.existsSync(resolved)) {
      try {
        canonicalTarget = fs.realpathSync(resolved);
      } catch {
        canonicalTarget = resolved;
      }
    }

    // Compute relative path from canonical root
    const rel = path.relative(canonicalRoot, canonicalTarget);

    // If relative path starts with '..' or is absolute, it is outside workspace
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Security Boundary Violation: Path "${rawPath}" resolves outside workspace root (${canonicalRoot}). Checkpoint / Undo rejected.`
      );
    }

    return { fullPath: canonicalTarget, relativePath: rel };
  }

  /**
   * Snapshot one or more files before a tool mutates them
   */
  public snapshot(filePaths: string[], description: string): CheckpointRecord {
    const seq = this.checkpoints.length + 1;
    const id = `cp_${Date.now()}_${seq}`;
    const snapshots: FileSnapshot[] = [];

    for (const rawPath of filePaths) {
      const { fullPath, relativePath } = this.sanitizeWorkspacePath(rawPath);

      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          snapshots.push({ filePath: fullPath, relativePath, existed: true, content });
        } catch {
          // Inaccessible or binary file
          snapshots.push({ filePath: fullPath, relativePath, existed: true });
        }
      } else {
        snapshots.push({ filePath: fullPath, relativePath, existed: false });
      }
    }

    const record: CheckpointRecord = {
      id,
      seq,
      timestamp: Date.now(),
      description,
      snapshots,
    };

    // Maintain sliding window ceiling
    if (this.checkpoints.length >= this.maxCheckpoints) {
      this.checkpoints.shift();
    }

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
        // Double-check workspace containment before executing file writes
        const { fullPath } = this.sanitizeWorkspacePath(snap.filePath);

        if (snap.existed && snap.content !== undefined) {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, snap.content, 'utf-8');
          revertedFiles.push(snap.relativePath || path.basename(fullPath));
        } else if (!snap.existed && fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          revertedFiles.push(`${snap.relativePath || path.basename(fullPath)} (removed newly created file)`);
        }
      } catch (err: any) {
        return { success: false, revertedFiles, error: `Failed to restore ${snap.filePath}: ${err.message}` };
      }
    }

    // Truncate all checkpoints from targetIndex to end of sequence
    this.checkpoints.splice(targetIndex);

    return { success: true, revertedFiles };
  }

  public getCheckpoints(): readonly CheckpointRecord[] {
    return this.checkpoints;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
