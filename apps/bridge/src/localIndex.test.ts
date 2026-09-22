import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IndexedNote } from '@obsidian-hub/protocol';
import { browseNotes, scanVault, searchNotes, type RegisteredVault } from './localIndex';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'hub-bridge-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function note(overrides: Partial<IndexedNote> & { id: string }): IndexedNote {
  return {
    vaultId: 'v',
    vaultName: 'V',
    relativePath: 'x.md',
    fileName: 'x.md',
    title: 'x',
    aliases: [],
    tags: [],
    modifiedAt: 0,
    size: 0,
    ...overrides,
  };
}

describe('scanVault', () => {
  it('indexes markdown files and skips ignored and hidden directories', async () => {
    const vaultRoot = path.join(tempDir, 'scan-vault');
    mkdirSync(path.join(vaultRoot, '.obsidian'), { recursive: true });
    mkdirSync(path.join(vaultRoot, 'node_modules'), { recursive: true });
    mkdirSync(path.join(vaultRoot, '.hidden'), { recursive: true });
    mkdirSync(path.join(vaultRoot, 'Projects'), { recursive: true });
    writeFileSync(path.join(vaultRoot, 'Home.md'), '# Home\n\nbody');
    writeFileSync(
      path.join(vaultRoot, 'Projects', 'TCP.md'),
      '---\naliases: [TCP 三次握手]\ntags: [network]\n---\n# TCP',
    );
    writeFileSync(path.join(vaultRoot, '.obsidian', 'app.json'), '{}');
    writeFileSync(path.join(vaultRoot, 'node_modules', 'skip.md'), '# nope');
    writeFileSync(path.join(vaultRoot, '.hidden', 'secret.md'), '# nope');

    const vault: RegisteredVault = { id: 'v1', name: 'Vault', path: vaultRoot };
    const notes = await scanVault(vault);

    expect(notes.map((entry) => entry.relativePath).sort()).toEqual(['Home.md', 'Projects/TCP.md']);
    const tcp = notes.find((entry) => entry.fileName === 'TCP.md');
    expect(tcp).toBeDefined();
    expect(tcp?.title).toBe('TCP');
    expect(tcp?.aliases).toEqual(['TCP 三次握手']);
    expect(tcp?.tags).toEqual(['network']);
    expect(tcp?.vaultId).toBe('v1');
  });

  it('returns an empty index for an inaccessible root', async () => {
    const notes = await scanVault({ id: 'v', name: 'V', path: path.join(tempDir, 'missing') });
    expect(notes).toEqual([]);
  });
});

describe('searchNotes', () => {
  it('ranks title matches ahead of path matches', () => {
    const notes = [
      note({ id: 'a', title: 'Other', relativePath: 'tcp/other.md', fileName: 'other.md' }),
      note({ id: 'b', title: 'TCP', relativePath: 'network/tcp.md', fileName: 'tcp.md' }),
    ];
    const result = searchNotes(notes, { query: 'tcp', limit: 20 });
    expect(result[0].title).toBe('TCP');
  });

  it('excludes the current vault when requested', () => {
    const notes = [
      note({ id: 'a', vaultId: 'a', vaultName: 'A', title: 'Target' }),
      note({ id: 'b', vaultId: 'b', vaultName: 'B', title: 'Target' }),
    ];
    const result = searchNotes(notes, { query: 'target', excludeVaultId: 'a', limit: 20 });
    expect(result.map((entry) => entry.vaultId)).toEqual(['b']);
  });
});

describe('browseNotes', () => {
  const notes = [
    note({ id: 'root', title: 'Root', relativePath: 'Root.md', fileName: 'Root.md' }),
    note({
      id: 'tcp',
      title: 'TCP',
      relativePath: 'Network/TCP.md',
      fileName: 'TCP.md',
    }),
    note({
      id: 'http',
      title: 'HTTP',
      relativePath: 'Network/Web/HTTP.md',
      fileName: 'HTTP.md',
    }),
  ];

  it('returns direct children folders and files at the root', () => {
    const result = browseNotes(notes, 'v', '', '', 20);
    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({ kind: 'folder', name: 'Network' });
  });

  it('filters recursively within the current directory', () => {
    const result = browseNotes(notes, 'v', 'Network', 'http', 20);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ kind: 'note', note: { title: 'HTTP' } });
  });

  it('paginates with hasMore', () => {
    const result = browseNotes(notes, 'v', 'Network', '', 1);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(true);
  });
});
