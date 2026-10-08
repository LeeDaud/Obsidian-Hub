import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkspaceNote, WorkspaceNotePreview } from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { toAppError } from '../../domain/appError';
import { WorkspaceDialog } from './WorkspaceDialog';
import type { CrossVaultLink } from '@obsidian-hub/cross-vault-parser';
import { MarkdownPreview } from './MarkdownPreview';

export function NotePreviewDialog({
  note,
  currentNote,
  gateway,
  onClose,
  onOpen,
  onLink,
  actions,
}: {
  note: WorkspaceNote;
  currentNote?: WorkspaceNote | null;
  gateway: VaultGateway;
  onClose(): void;
  onOpen(): void;
  onLink(link: CrossVaultLink): void;
  actions?: ReactNode;
}) {
  const [preview, setPreview] = useState<WorkspaceNotePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const unavailable = currentNote === null;
  const stale = !!(
    preview &&
    currentNote &&
    currentNote.contentHash !== note.contentHash &&
    currentNote.contentHash !== preview.contentHash
  );

  const load = useCallback(async () => {
    if (!gateway.readWorkspaceNote) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await gateway.readWorkspaceNote(
        note.vaultId,
        note.relativePath,
        note.contentHash,
      );
      if (request === generation.current) setPreview(result);
    } catch (reason) {
      if (request === generation.current) setError(toAppError(reason).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [gateway, note.contentHash, note.relativePath, note.vaultId]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <WorkspaceDialog
      title={note.title}
      onClose={onClose}
      busy={loading}
      className="note-preview-dialog"
    >
      <div className="note-preview">
        <div className="note-preview-meta">
          <span>
            {note.vaultName} / {note.relativePath}
          </span>
          {preview?.changed && <strong>文件已变化，当前显示磁盘最新内容</strong>}
        </div>
        {loading && <p className="workspace-subtle">正在读取笔记…</p>}
        {error && (
          <p className="workspace-alert" role="alert">
            {error}
          </p>
        )}
        {unavailable && (
          <p className="workspace-alert" role="alert">
            笔记已移动、删除或仓库离线，请关闭预览后刷新工作台。
          </p>
        )}
        {!unavailable && stale && (
          <p className="workspace-message" role="status">
            笔记已有新版本，点击刷新后继续操作。
          </p>
        )}
        {!loading && !error && (
          <article className="note-preview-content">
            {preview?.content.trim() ? (
              <MarkdownPreview source={preview.content} onLink={onLink} />
            ) : (
              <p className="workspace-subtle">这是一篇空笔记。</p>
            )}
          </article>
        )}
        <footer>
          {!loading && !error && !stale && !unavailable ? actions : null}
          <button type="button" disabled={loading} onClick={() => void load()}>
            刷新
          </button>
          <button
            type="button"
            className="workspace-primary"
            disabled={unavailable}
            onClick={onOpen}
          >
            在 Obsidian 中打开
          </button>
        </footer>
      </div>
    </WorkspaceDialog>
  );
}
