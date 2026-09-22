import { readFileSync, promises as fsp } from 'fs';
import * as path from 'path';
import type {
  HubVault,
  IndexedNote,
  NoteContentResponse,
  VaultBrowseItem,
  VaultBrowseResponse,
} from '@obsidian-hub/protocol';
import { browseNotes, scanDirectoryLevel, scanVault, type RegisteredVault } from './localIndex';
import type { BridgeSettings } from './types';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const SCAN_CACHE_TTL_MS = 3000;

interface RegistryVault {
  id: string;
  name: string;
  path: string;
}

interface RegistryFile {
  schemaVersion: number;
  vaults: RegistryVault[];
}

interface ScanCacheEntry {
  notes: IndexedNote[];
  at: number;
}

export class LocalClient {
  private registeredVaults: RegisteredVault[] = [];
  private scanCache = new Map<string, ScanCacheEntry>();

  constructor(private readonly settings: () => BridgeSettings) {}

  currentVaultId(): string {
    return this.settings().vaultId;
  }

  resultLimit(): number {
    return this.settings().resultLimit;
  }

  async load(): Promise<void> {
    const registryPath = this.settings().registryPath;
    this.registeredVaults = registryPath ? readRegistry(registryPath) : [];
    this.scanCache.clear();
  }

  async vaults(): Promise<HubVault[]> {
    return this.registeredVaults.map(({ id, name }) => ({ id, name }));
  }

  async browse(
    vaultId: string,
    directory: string,
    query: string,
    limit: number,
  ): Promise<VaultBrowseResponse> {
    const vault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    if (!vault) return { items: [], total: 0, hasMore: false };
    await this.assertVaultAccessible(vault);
    if (!query.trim()) {
      return this.browseLevel(vault, directory, limit);
    }
    const notes = await this.scanVaultCached(vaultId);
    return browseNotes(notes, vaultId, directory, query, limit);
  }

  private async browseLevel(
    vault: RegisteredVault,
    directory: string,
    limit: number,
  ): Promise<VaultBrowseResponse> {
    const level = await scanDirectoryLevel(vault, directory);
    const items: VaultBrowseItem[] = [
      ...level.folders.map((folder) => ({ kind: 'folder' as const, ...folder })),
      ...level.notes.map((note) => ({ kind: 'note' as const, note })),
    ];
    const total = items.length;
    const limited = items.slice(0, Math.max(1, Math.min(limit, 5000)));
    return { items: limited, total, hasMore: limited.length < total };
  }

  async resolve(vault: string, notePath: string, vaultId?: string): Promise<IndexedNote> {
    let targetVault: RegisteredVault | undefined;
    if (vaultId) {
      targetVault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    } else {
      const matches = this.registeredVaults.filter(
        (candidate) => candidate.name.toLowerCase() === vault.toLowerCase(),
      );
      if (matches.length > 1) throw new Error('VAULT_AMBIGUOUS');
      targetVault = matches[0];
    }
    if (!targetVault) throw new Error('NOTE_NOT_FOUND');
    await this.assertVaultAccessible(targetVault);
    const notes = await this.scanVaultCached(targetVault.id);
    const targetPath = notePath.replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase();
    const note = notes.find(
      (candidate) => candidate.relativePath.replace(/\.md$/i, '').toLowerCase() === targetPath,
    );
    if (!note) throw new Error('NOTE_NOT_FOUND');
    return note;
  }

  async content(note: IndexedNote): Promise<NoteContentResponse> {
    const vault = this.registeredVaults.find((candidate) => candidate.id === note.vaultId);
    if (!vault) throw new Error('VAULT_NOT_FOUND');
    const relativePath = note.relativePath;
    if (
      !relativePath.toLowerCase().endsWith('.md') ||
      relativePath.split('/').some((segment) => segment === '..')
    ) {
      throw new Error('INVALID_LINK');
    }
    let root: string;
    let target: string;
    try {
      root = await fsp.realpath(vault.path);
      target = await fsp.realpath(path.join(vault.path, relativePath));
    } catch {
      throw new Error('NOTE_NOT_FOUND');
    }
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('INVALID_LINK');
    }
    const stats = await fsp.stat(target).catch(() => {
      throw new Error('NOTE_NOT_FOUND');
    });
    if (stats.size > MAX_CONTENT_BYTES) throw new Error('NOTE_TOO_LARGE');
    const content = await fsp.readFile(target, 'utf8').catch(() => {
      throw new Error('NOTE_READ_FAILED');
    });
    return { note, content: this.resolveEmbeddedAssets(vault, note, content) };
  }

  private resolveEmbeddedAssets(
    vault: RegisteredVault,
    note: IndexedNote,
    content: string,
  ): string {
    const noteDir = path.dirname(path.join(vault.path, note.relativePath));
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'];
    const isImage = (target: string) =>
      imageExtensions.some((extension) => target.toLowerCase().endsWith(extension));
    const isExternal = (target: string) =>
      /^(https?:|file:|data:|app:|\/|[a-zA-Z]:)/.test(target.trim());

    const toFileUrl = (target: string): string | null => {
      if (isExternal(target)) return null;
      const absolute = path.resolve(noteDir, target);
      const relative = path.relative(vault.path, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
      return `file:///${absolute.replace(/\\/g, '/')}`;
    };

    const resolvedMarkdownImages = content.replace(
      /!\[([^\]]*)\]\(([^)\n]+)\)/g,
      (full, alt, target) => {
        const cleanTarget = target.split('#')[0].split('|')[0].trim();
        if (!isImage(cleanTarget)) return full;
        const fileUrl = toFileUrl(cleanTarget);
        return fileUrl ? `![${alt}](${fileUrl})` : full;
      },
    );

    return resolvedMarkdownImages.replace(/!\[\[([^\]]+)\]\]/g, (full, target) => {
      const cleanTarget = target.split('|')[0].split('#')[0].split('^')[0].trim();
      if (!isImage(cleanTarget)) return full;
      const fileUrl = toFileUrl(cleanTarget);
      return fileUrl ? `![](${fileUrl})` : full;
    });
  }

  async open(note: IndexedNote, heading?: string, blockId?: string): Promise<{ uri: string }> {
    const params = new URLSearchParams({
      vault: note.vaultName,
      file: note.relativePath.replace(/\.md$/i, ''),
    });
    if (heading) params.set('heading', heading);
    if (blockId) params.set('block', blockId);
    const uri = `obsidian://open?${params.toString()}`;
    window.open(uri, '_blank');
    return { uri };
  }

  async health(): Promise<{ status: string }> {
    return { status: 'ok' };
  }

  private async assertVaultAccessible(vault: RegisteredVault): Promise<void> {
    try {
      const stats = await fsp.stat(vault.path);
      if (!stats.isDirectory()) throw new Error();
    } catch {
      throw new Error(`VAULT_OFFLINE:${vault.name}`);
    }
  }

  private async scanVaultCached(vaultId: string): Promise<IndexedNote[]> {
    const cached = this.scanCache.get(vaultId);
    const now = Date.now();
    if (cached && now - cached.at < SCAN_CACHE_TTL_MS) {
      return cached.notes;
    }
    const vault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    if (!vault) return [];
    const notes = await scanVault(vault);
    this.scanCache.set(vaultId, { notes, at: now });
    return notes;
  }
}

function readRegistry(registryPath: string): RegisteredVault[] {
  let registry: RegistryFile;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8')) as RegistryFile;
  } catch {
    return [];
  }
  return (registry.vaults ?? [])
    .filter((vault) => vault.id && vault.name && vault.path)
    .map(({ id, name, path: vaultPath }) => ({ id, name, path: vaultPath }));
}
