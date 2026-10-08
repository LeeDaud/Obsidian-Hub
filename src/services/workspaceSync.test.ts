import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceNote, WorkspaceScopeUpdate, WorkspaceSnapshot } from '../domain/workspace';
import { mergeWorkspaceUpdates, WorkspaceSync } from './workspaceSync';

const note = (path: string, hash = 'old'): WorkspaceNote => ({
  id: `v:${path.toLowerCase()}`,
  vaultId: 'v',
  vaultName: 'Vault',
  relativePath: path,
  fileName: path.split('/').pop()!,
  title: path,
  aliases: [],
  tags: [],
  modifiedAt: 1,
  size: 10,
  contentHash: hash,
});
const scope = (path: string) => ({ vaultId: 'v', relativePath: path });
const update = (path: string, notes: WorkspaceNote[] = []): WorkspaceScopeUpdate => ({
  scope: scope(path),
  notes,
  tasks: [],
  relations: [],
  failedPaths: [],
  status: { vaultId: 'v', online: true, readErrors: 0 },
});
const initial = (): WorkspaceSnapshot => ({
  notes: [note('Folder/a.md'), note('other.md')],
  tasks: [
    {
      ...scope('Folder/a.md'),
      id: 'task',
      vaultName: 'Vault',
      lineNumber: 2,
      text: 'Task',
      complete: false,
      contentHash: 'old',
    },
  ],
  relations: [
    {
      source: { vaultId: 'echo', relativePath: 'idea.md' },
      target: scope('Folder/a.md'),
      kind: 'origin',
    },
    {
      source: scope('Folder/a.md'),
      target: { vaultId: 'output', relativePath: 'out.md' },
      kind: 'origin',
    },
  ],
  vaultStatuses: [{ vaultId: 'v', online: true, readErrors: 0 }],
  scannedAt: 1,
  fromCache: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('workspace incremental merge', () => {
  it('replaces a file, its tasks and owned relations while preserving downstream broken links', () => {
    const before = initial();
    const next = mergeWorkspaceUpdates(before, [
      update('folder/A.md', [note('Folder/a.md', 'new')]),
    ]);
    expect(next.notes).toHaveLength(2);
    expect(next.notes.find((n) => n.relativePath === 'Folder/a.md')?.contentHash).toBe('new');
    expect(next.notes.find((n) => n.relativePath === 'other.md')).toBe(before.notes[1]);
    expect(next.tasks).toEqual([]);
    expect(next.relations).toEqual([before.relations![1]]);
    expect(next.scannedAt).toBe(1);
    expect(before.notes[0].contentHash).toBe('old');
  });

  it('removes a moved subtree and adds its new paths without matching sibling names', () => {
    const before = initial();
    before.notes.push(note('Folder-other/keep.md'));
    const next = mergeWorkspaceUpdates(before, [
      update('Folder'),
      update('Renamed', [note('Renamed/a.md')]),
    ]);
    expect(next.notes.map((n) => n.relativePath)).toEqual([
      'other.md',
      'Folder-other/keep.md',
      'Renamed/a.md',
    ]);
    expect(next.tasks).toEqual([]);
  });

  it('preserves failed files and merges successful files without duplicates after partial directory failure', () => {
    const patch = update('', [note('other.md', 'new')]);
    patch.failedPaths = [''];
    patch.status.readErrors = 1;
    const next = mergeWorkspaceUpdates(initial(), [patch]);
    expect(next.notes).toHaveLength(2);
    expect(next.notes[0].contentHash).toBe('old');
    expect(next.notes[1].contentHash).toBe('new');
    expect(next.tasks).toHaveLength(1);
    expect(next.vaultStatuses[0].readErrors).toBe(1);
  });

  it('marks an offline root and keeps other vaults untouched', () => {
    const before = initial();
    before.notes.push({ ...note('keep.md'), vaultId: 'other' });
    const patch = update('');
    patch.status.online = false;
    const next = mergeWorkspaceUpdates(before, [patch]);
    expect(next.notes.map((n) => n.vaultId)).toEqual(['other']);
    expect(next.vaultStatuses[0].online).toBe(false);
  });
});

describe('WorkspaceSync', () => {
  it('buffers startup events and coalesces high-frequency changes into a single subtree read', async () => {
    const read = vi.fn().mockResolvedValue([]);
    const sync = new WorkspaceSync(read, vi.fn(), vi.fn());
    for (let i = 0; i < 1000; i++) sync.enqueue([scope('Folder/a.md')]);
    sync.enqueue([scope('folder')]);
    expect(read).not.toHaveBeenCalled();
    sync.resume();
    await settle();
    expect(read).toHaveBeenCalledExactlyOnceWith([scope('folder')]);
  });

  it('defers only a locked file while reading unrelated changes', async () => {
    const read = vi.fn().mockResolvedValue([]);
    const sync = new WorkspaceSync(read, vi.fn(), vi.fn());
    sync.lock(scope('Folder/a.md'));
    sync.resume();
    sync.enqueue([scope('folder/A.md'), scope('other.md')]);
    await settle();
    expect(read).toHaveBeenCalledExactlyOnceWith([scope('other.md')]);
    sync.unlock(scope('Folder/a.md'));
    await settle();
    expect(read).toHaveBeenLastCalledWith([scope('folder/A.md')]);
  });

  it('discards a read crossing a task write and re-reads after the write finishes', async () => {
    const old = deferred<WorkspaceScopeUpdate[]>();
    const newest = [update('a.md', [note('a.md', 'new')])];
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(newest);
    const apply = vi.fn();
    const sync = new WorkspaceSync(read, apply, vi.fn());
    sync.resume();
    sync.enqueue([scope('a.md')]);
    sync.lock(scope('a.md'));
    sync.unlock(scope('a.md'));
    old.resolve([update('a.md', [note('a.md', 'stale')])]);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledExactlyOnceWith(newest);
  });

  it('buffers changes during full refresh and rejects reads issued before refresh', async () => {
    const old = deferred<WorkspaceScopeUpdate[]>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([]);
    const apply = vi.fn();
    const sync = new WorkspaceSync(read, apply, vi.fn());
    sync.resume();
    sync.enqueue([scope('a.md')]);
    sync.pause();
    sync.enqueue([scope('b.md')]);
    old.resolve([update('a.md')]);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    sync.resume();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toEqual(expect.arrayContaining([scope('a.md'), scope('b.md')]));
  });

  it('warns on read failure without retrying forever and accepts subsequent events', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue([]);
    const warn = vi.fn();
    const sync = new WorkspaceSync(read, vi.fn(), warn);
    sync.resume();
    sync.enqueue([scope('a.md')]);
    await settle();
    expect(warn).toHaveBeenCalledWith('WORKSPACE_REFRESH_FAILED');
    expect(read).toHaveBeenCalledTimes(1);
    sync.enqueue([scope('a.md')]);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('bounds pending paths and reports overflow requiring manual refresh', () => {
    const warn = vi.fn();
    const read = vi.fn();
    const sync = new WorkspaceSync(read, vi.fn(), warn);
    sync.enqueue(Array.from({ length: 513 }, (_, i) => scope(`${i}.md`)));
    expect(warn).toHaveBeenCalledWith('WORKSPACE_WATCH_OVERFLOW');
    sync.resume();
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores in-flight results and queued events after cleanup', async () => {
    const old = deferred<WorkspaceScopeUpdate[]>();
    const read = vi.fn().mockReturnValue(old.promise);
    const apply = vi.fn();
    const sync = new WorkspaceSync(read, apply, vi.fn());
    sync.resume();
    sync.enqueue([scope('a.md')]);
    sync.dispose();
    old.resolve([update('a.md')]);
    sync.enqueue([scope('b.md')]);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('incremental body link ownership', () => {
  it('replaces candidates owned by the changed source rather than deleting a referenced target', () => {
    const before = initial();
    before.linkCandidates = [
      { owner: scope('Folder/a.md'), raw: ['@Output:o[[out.md]]'], truncated: false },
      { owner: scope('other.md'), raw: ['@Echo:e[[idea.md]]'], truncated: false },
    ];
    const patch = update('Folder/a.md', [note('Folder/a.md', 'new')]);
    patch.linkCandidates = [{ owner: scope('Folder/a.md'), raw: [], truncated: false }];
    const next = mergeWorkspaceUpdates(before, [patch]);
    expect(next.linkCandidates?.find((c) => c.owner.relativePath === 'Folder/a.md')?.raw).toEqual(
      [],
    );
    expect(next.linkCandidates?.find((c) => c.owner.relativePath === 'other.md')?.raw).toEqual([
      '@Echo:e[[idea.md]]',
    ]);
    const deleted = mergeWorkspaceUpdates(next, [update('other.md')]);
    expect(deleted.linkCandidates).toHaveLength(1);
  });
});
