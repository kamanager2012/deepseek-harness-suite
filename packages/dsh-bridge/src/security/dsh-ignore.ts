import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_IGNORED_PATTERNS = [
  '.git',
  '.git/**',
  'node_modules',
  'node_modules/**',
  'dist',
  'dist/**',
  'build',
  'build/**',
  '.dsh',
  '.dsh/**',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.pfx',
  'id_rsa',
  'id_ed25519',
  '.DS_Store',
  'Thumbs.db',
];

/**
 * DSH Ignore & Sensitive Path Defense Engine
 * 
 * Prevents AI tools from inadvertently reading, modifying, or deleting
 * private credentials (.env, keys) or scanning giant trees (node_modules, .git).
 */
export class DshIgnoreMatcher {
  private patterns: Set<string>;
  private workspacePath: string;

  constructor(workspacePath: string = process.cwd()) {
    this.workspacePath = workspacePath;
    this.patterns = new Set(DEFAULT_IGNORED_PATTERNS);
    this.loadCustomIgnoreFiles();
  }

  private loadCustomIgnoreFiles(): void {
    const ignoreFiles = ['.dshignore', '.gitignore'];
    for (const file of ignoreFiles) {
      const fullPath = path.join(this.workspacePath, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'));
          for (const line of lines) {
            this.patterns.add(line);
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  /**
   * Check if a relative or absolute file path is protected/ignored
   */
  public isIgnored(targetPath: string): boolean {
    const normalized = targetPath.replace(/\\/g, '/');
    const baseName = path.basename(normalized);

    // Check sensitive file exact names
    if (
      baseName === '.env' ||
      baseName.startsWith('.env.') ||
      baseName.endsWith('.pem') ||
      baseName.endsWith('.key') ||
      baseName === 'id_rsa' ||
      baseName === 'id_ed25519'
    ) {
      return true;
    }

    // Check directory containment
    const parts = normalized.split('/');
    if (parts.includes('node_modules') || parts.includes('.git') || parts.includes('.dsh')) {
      return true;
    }

    for (const pattern of this.patterns) {
      const cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '');
      if (normalized === cleanPattern || baseName === cleanPattern) {
        return true;
      }
      if (cleanPattern.endsWith('/**') && normalized.startsWith(cleanPattern.slice(0, -3))) {
        return true;
      }
    }

    return false;
  }

  public getPatterns(): string[] {
    return Array.from(this.patterns);
  }
}
