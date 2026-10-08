import type { WorkspaceChange, WorkspaceScopeUpdate, WorkspaceSnapshot } from '../domain/workspace';

export function scopeContains(scope: WorkspaceChange, note: WorkspaceChange): boolean {
  const parent = scope.relativePath.toLocaleLowerCase();
  const child = note.relativePath.toLocaleLowerCase();
  return (
    scope.vaultId === note.vaultId &&
    (!parent || parent === child || child.startsWith(`${parent}/`))
  );
}

export function mergeWorkspaceUpdates(
  snapshot: WorkspaceSnapshot,
  updates: WorkspaceScopeUpdate[],
): WorkspaceSnapshot {
  let next = snapshot;
  for (const update of updates) {
    const successful = new Set(
      update.notes.map((note) => `${note.vaultId}:${note.relativePath.toLocaleLowerCase()}`),
    );
    const replace = (note: WorkspaceChange) =>
      scopeContains(update.scope, note) &&
      (successful.has(`${note.vaultId}:${note.relativePath.toLocaleLowerCase()}`) ||
        !update.failedPaths.some((relativePath) =>
          scopeContains({ vaultId: update.scope.vaultId, relativePath }, note),
        ));
    next = {
      ...next,
      notes: [...next.notes.filter((note) => !replace(note)), ...update.notes],
      tasks: [...next.tasks.filter((task) => !replace(task)), ...update.tasks],
      // origin/references are owned by the downstream note's frontmatter.
      relations: [
        ...(next.relations ?? []).filter((link) => !replace(link.target)),
        ...update.relations,
      ],
      linkCandidates: [
        ...(next.linkCandidates ?? []).filter((candidate) => !replace(candidate.owner)),
        ...(update.linkCandidates ?? []),
      ],
      vaultStatuses: next.vaultStatuses.map((status) =>
        status.vaultId === update.status.vaultId
          ? {
              ...update.status,
              readErrors: update.scope.relativePath
                ? Math.max(status.readErrors, update.status.readErrors)
                : update.status.readErrors,
            }
          : status,
      ),
    };
  }
  return next;
}

/** Ephemeral queue. No body, absolute path or persistent index is retained here. */
export class WorkspaceSync {
  private pending = new Map<string, WorkspaceChange>();
  private locks = new Map<string, WorkspaceChange>();
  private running = false;
  private paused = true;
  private disposed = false;
  private revision = 0;

  constructor(
    private read: (changes: WorkspaceChange[]) => Promise<WorkspaceScopeUpdate[]>,
    private apply: (updates: WorkspaceScopeUpdate[]) => void,
    private warn: (code: string) => void,
  ) {}

  private key(change: WorkspaceChange) {
    return `${change.vaultId}:${change.relativePath.toLocaleLowerCase()}`;
  }

  enqueue(changes: WorkspaceChange[]) {
    if (this.disposed) return;
    for (const change of changes) {
      if ([...this.pending.values()].some((scope) => scopeContains(scope, change))) continue;
      for (const [key, scope] of this.pending) {
        if (scopeContains(change, scope)) this.pending.delete(key);
      }
      this.pending.set(this.key(change), change);
    }
    if (this.pending.size > 512) {
      this.pending.clear();
      this.warn('WORKSPACE_WATCH_OVERFLOW');
    }
    void this.flush();
  }

  pause() {
    this.paused = true;
    this.revision += 1;
  }

  resume() {
    this.paused = false;
    void this.flush();
  }

  lock(note: WorkspaceChange) {
    this.locks.set(this.key(note), note);
    this.revision += 1;
  }

  unlock(note: WorkspaceChange) {
    this.locks.delete(this.key(note));
    this.revision += 1;
    void this.flush();
  }

  dispose() {
    this.disposed = true;
    this.pending.clear();
    this.locks.clear();
  }

  private blocked(scope: WorkspaceChange) {
    return [...this.locks.values()].some(
      (note) => scopeContains(scope, note) || scopeContains(note, scope),
    );
  }

  private async flush() {
    if (this.disposed || this.running || this.paused) return;
    this.running = true;
    try {
      while (!this.disposed && !this.paused) {
        const changes = [...this.pending.values()].filter((scope) => !this.blocked(scope));
        if (!changes.length) break;
        for (const change of changes) this.pending.delete(this.key(change));
        const revision = this.revision;
        try {
          const updates = await this.read(changes);
          if (this.disposed) break;
          if (revision !== this.revision) {
            // A full refresh or a write occurred while the read was in flight.
            this.enqueue(changes);
            continue;
          }
          this.apply(updates);
          if (updates.some((update) => update.failedPaths.length))
            this.warn('WORKSPACE_REFRESH_FAILED');
        } catch {
          if (!this.disposed) this.warn('WORKSPACE_REFRESH_FAILED');
          // Keep failures actionable without an infinite automatic retry loop.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
