import { readFileSync, promises as fsp } from 'fs';
import * as path from 'path';
import type {
  HubVault,
  IndexedNote,
  NoteContentResponse,
  VaultBrowseResponse,
} from '@obsidian-hub/protocol';
import { browseNotes, scanVault, searchNotes, type RegisteredVault } from './localIndex';
import type { BridgeSettings } from './types';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

interface RegistryVault {
  id: string;
  name: string;
  path: string;
}

interface RegistryFile {
  schemaVersion: number;
  vaults: RegistryVault[];
}

export class LocalClient {
  private registeredVaults: RegisteredVault[] = [];
  private notes: IndexedNote[] = [];

  constructor(private readonly settings: () => BridgeSettings) {}

  currentVaultId(): string {
    return this.settings().vaultId;
  }

  resultLimit(): number {
    return this.settings().resultLimit;
  }

  async load(): Promise<void> {
    const registryPath = this.settings().registryPath;
    const vaults = registryPath ? readRegistry(registryPath) : [];
    this.registeredVaults = vaults;
    const results = await Promise.all(vaults.map((vault) => scanVault(vault)));
    this.notes = results.flat();
  }

  async vaults(): Promise<HubVault[]> {
    return this.registeredVaults.map(({ id, name }) => ({ id, name }));
  }

  async search(query: string, vaultId?: string): Promise<IndexedNote[]> {
    const settings = this.settings();
    return searchNotes(this.notes, {
      query,
      excludeVaultId:
        settings.excludeCurrentVault && settings.vaultId ? settings.vaultId : undefined,
      vaultId,
      limit: settings.resultLimit,
    });
  }

  async browse(
    vaultId: string,
    directory: string,
    query: string,
    limit: number,
  ): Promise<VaultBrowseResponse> {
    return browseNotes(this.notes, vaultId, directory, query, limit);
  }

  async resolve(vault: string, notePath: string): Promise<IndexedNote> {
    const targetVault = vault.toLowerCase();
    const targetPath = notePath.replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase();
    const note = this.notes.find(
      (candidate) =>
        candidate.vaultName.toLowerCase() === targetVault &&
        candidate.relativePath.replace(/\.md$/i, '').toLowerCase() === targetPath,
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
    return { note, content };
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
