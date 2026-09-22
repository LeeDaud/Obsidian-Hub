import { promises as fsp, type Dirent } from 'fs';
import * as path from 'path';
import type { IndexedNote, VaultBrowseItem, VaultBrowseResponse } from '@obsidian-hub/protocol';

export interface RegisteredVault {
  id: string;
  name: string;
  path: string;
}

const IGNORED_DIRECTORIES = ['.obsidian', '.git', '.trash', 'node_modules', 'target', 'dist'];

function frontmatterValues(contents: string, key: string): string[] {
  if (!contents.startsWith('---\n')) return [];
  const end = contents.indexOf('\n---', 4);
  if (end < 0) return [];
  const frontmatter = contents.slice(4, end);
  const line = frontmatter
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${key}:`));
  if (!line) return [];
  const colon = line.indexOf(':');
  const value = line.slice(colon + 1).trim();
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => item.length > 0);
}

function firstHeading(contents: string): string | undefined {
  for (const line of contents.split('\n')) {
    if (line.startsWith('# ')) {
      const title = line.slice(2).trim();
      if (title) return title;
    }
  }
  return undefined;
}

async function scanDirectory(
  root: string,
  directory: string,
  vault: RegisteredVault,
  notes: IndexedNote[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name.startsWith('.') ||
        IGNORED_DIRECTORIES.some((name) => name.toLowerCase() === entry.name.toLowerCase())
      ) {
        continue;
      }
      await scanDirectory(root, fullPath, vault, notes);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      let contents = '';
      try {
        contents = await fsp.readFile(fullPath, 'utf8');
      } catch {
        // 保留空正文，文件仍可被索引
      }
      let modifiedAt = 0;
      let size = 0;
      try {
        const stats = await fsp.stat(fullPath);
        modifiedAt = Math.floor(stats.mtimeMs);
        size = stats.size;
      } catch {
        // 统计失败时保留默认值
      }
      notes.push({
        id: `${vault.id}:${relativePath.toLowerCase()}`,
        vaultId: vault.id,
        vaultName: vault.name,
        relativePath,
        fileName: entry.name,
        title: firstHeading(contents) ?? entry.name.replace(/\.md$/i, ''),
        aliases: frontmatterValues(contents, 'aliases'),
        tags: frontmatterValues(contents, 'tags'),
        modifiedAt,
        size,
      });
    }
  }
}

export async function scanVault(vault: RegisteredVault): Promise<IndexedNote[]> {
  const notes: IndexedNote[] = [];
  try {
    const stats = await fsp.stat(vault.path);
    if (stats.isDirectory()) {
      await scanDirectory(vault.path, vault.path, vault, notes);
    }
  } catch {
    // 路径不可访问时返回空索引
  }
  return notes;
}

export interface SearchOptions {
  query: string;
  excludeVaultId?: string;
  vaultId?: string;
  limit: number;
}

export function searchNotes(notes: IndexedNote[], options: SearchOptions): IndexedNote[] {
  const terms = options.query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const ranked: Array<[number, IndexedNote]> = [];
  for (const note of notes) {
    if (options.excludeVaultId && note.vaultId === options.excludeVaultId) continue;
    if (options.vaultId && note.vaultId !== options.vaultId) continue;
    const title = note.title.toLowerCase();
    const relativePath = note.relativePath.toLowerCase();
    const aliases = note.aliases.join(' ').toLowerCase();
    if (
      !terms.every(
        (term) => title.includes(term) || relativePath.includes(term) || aliases.includes(term),
      )
    ) {
      continue;
    }
    const score = terms.reduce((sum, term) => {
      if (title === term) return sum + 100;
      if (title.startsWith(term)) return sum + 50;
      if (title.includes(term)) return sum + 25;
      if (aliases.includes(term)) return sum + 15;
      return sum + 5;
    }, 0);
    ranked.push([score, note]);
  }
  ranked.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
  return ranked.slice(0, Math.min(options.limit, 50)).map(([, note]) => note);
}

function folderName(item: VaultBrowseItem): string {
  return item.kind === 'folder' ? item.name : '';
}

function noteTitle(item: VaultBrowseItem): string {
  return item.kind === 'note' ? item.note.title : '';
}

export function browseNotes(
  notes: IndexedNote[],
  vaultId: string,
  directory: string,
  query: string,
  limit: number,
): VaultBrowseResponse {
  const trimmed = directory.replace(/^\/+|\/+$/g, '');
  const prefix = trimmed ? `${trimmed}/` : '';
  const normalizedQuery = query.trim().toLowerCase();

  let items: VaultBrowseItem[];
  if (!normalizedQuery) {
    const folders = new Map<string, VaultBrowseItem>();
    const files: VaultBrowseItem[] = [];
    for (const note of notes) {
      if (note.vaultId !== vaultId || !note.relativePath.startsWith(prefix)) continue;
      const remainder = note.relativePath.slice(prefix.length);
      const slash = remainder.indexOf('/');
      if (slash >= 0) {
        const folder = remainder.slice(0, slash);
        const key = folder.toLowerCase();
        if (!folders.has(key)) {
          folders.set(key, {
            kind: 'folder',
            name: folder,
            path: trimmed ? `${trimmed}/${folder}` : folder,
          });
        }
      } else {
        files.push({ kind: 'note', note });
      }
    }
    const folderList = [...folders.values()].sort((a, b) =>
      folderName(a).localeCompare(folderName(b)),
    );
    files.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
    items = [...folderList, ...files];
  } else {
    const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 0);
    items = notes
      .filter((note) => note.vaultId === vaultId && note.relativePath.startsWith(prefix))
      .filter((note) => {
        const haystack =
          `${note.fileName} ${note.title} ${note.relativePath} ${note.aliases.join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .map((note): VaultBrowseItem => ({ kind: 'note', note }))
      .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
  }

  const total = items.length;
  const limited = items.slice(0, Math.max(1, Math.min(limit, 5000)));
  return { items: limited, total, hasMore: limited.length < total };
}
