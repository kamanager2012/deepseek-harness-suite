export const PLUGIN_CATEGORIES = ['ui', 'tool', 'provider', 'workflow', 'other'] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export interface PluginVersion {
  version: string;
  testedDsh: string;
  notes?: string;
}

export interface PluginEntry {
  name: string;
  description: string;
  author: string;
  repo: string;
  category: PluginCategory;
  versions: PluginVersion[];
}

export interface PluginCatalog {
  version: 1;
  updatedAt: string;
  plugins: PluginEntry[];
}

const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/kamanager2012/dsh-community-plugins/main/catalog.json';

const FALLBACK_CATALOG: PluginCatalog = {
  version: 1,
  updatedAt: '2026-08-16T00:00:00Z',
  plugins: [
    {
      name: 'dsh-context',
      description: '上下文洞察面板:看模型上下文窗口的构成与演化',
      author: 'bowenliang123',
      repo: 'https://github.com/bowenliang123/dsh-context',
      category: 'ui',
      versions: [{ version: '0.8.0', testedDsh: '0.1.0-rc.8' }],
    },
    {
      name: 'dsh-compressor',
      description: '工具输出压缩:最高省约 20% 上下文,不影响模型的上下文缓存与 agent 性能',
      author: 'lifeodyssey',
      repo: 'https://github.com/lifeodyssey/dsh-compressor',
      category: 'tool',
      versions: [{ version: '0.1.0', testedDsh: '0.1.0-rc.8' }],
    },
    {
      name: 'dsh-memory-vault',
      description: '跨会话记忆库:memory_remember / memory_recall 工具',
      author: 'flymysql',
      repo: 'https://github.com/flymysql/dsh-memory',
      category: 'tool',
      versions: [{ version: '0.1.5', testedDsh: '0.1.0-rc.8' }],
    },
    {
      name: 'dsh-working-activity',
      description: '工作状态行数据源:思考文案/运行中工具/回合摘要',
      author: 'dsh-community',
      repo: 'https://github.com/kamanager2012/dsh-community',
      category: 'ui',
      versions: [{ version: '0.2.4', testedDsh: '0.1.0-rc.8' }],
    },
  ],
};

/**
 * DSH Plugin Marketplace Client
 * 
 * Fetches and filters validated plugins from the community registry (dsh-community-plugins).
 */
export class DshPluginCatalogClient {
  private catalogCache: PluginCatalog | null = null;
  private lastFetchTime = 0;
  private readonly ttlMs = 5 * 60 * 1000; // 5 minutes cache

  public async getCatalog(customUrl?: string): Promise<PluginCatalog> {
    if (this.catalogCache && Date.now() - this.lastFetchTime < this.ttlMs) {
      return this.catalogCache;
    }

    try {
      const url = customUrl || DEFAULT_CATALOG_URL;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = (await res.json()) as PluginCatalog;
        if (data && Array.isArray(data.plugins)) {
          this.catalogCache = data;
          this.lastFetchTime = Date.now();
          return data;
        }
      }
    } catch {
      // Fallback to built-in cache if offline
    }

    return this.catalogCache || FALLBACK_CATALOG;
  }

  public async searchPlugins(query: string): Promise<PluginEntry[]> {
    const catalog = await this.getCatalog();
    const q = (query || '').toLowerCase().trim();
    if (!q) return catalog.plugins;

    return catalog.plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }

  public formatPluginList(plugins: PluginEntry[], currentDshVersion = '0.1.0-rc.8'): string {
    if (plugins.length === 0) {
      return 'No matching plugins found in the registry.';
    }

    let output = `📦 DSH Community Plugin Marketplace (${plugins.length} plugins found):\n\n`;
    for (const p of plugins) {
      const latest = p.versions[p.versions.length - 1];
      const isTested = latest?.testedDsh === currentDshVersion;
      const testBadge = isTested ? `✅ tested on ${currentDshVersion}` : `⚠️ tested on ${latest?.testedDsh || 'untested'}`;

      output += `• ${p.name} (v${latest?.version || '0.1.0'}) [${p.category}]\n`;
      output += `  ${p.description}\n`;
      output += `  Compatibility: ${testBadge}\n`;
      output += `  Install command: dsh plugin add ${p.name}\n\n`;
    }
    output += `To install any plugin, run: dsh plugin add <package-name>`;
    return output.trim();
  }
}
