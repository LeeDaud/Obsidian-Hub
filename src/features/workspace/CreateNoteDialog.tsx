import { useState, type FormEvent } from 'react';
import type { AppConfigV2 } from '../../domain/vault';
import type {
  CreateWorkspaceNoteRequest,
  WorkspaceNote,
  WorkspaceFileResult,
} from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { toAppError } from '../../domain/appError';
import { noteNameError, noteTargetPath } from './noteNaming';
import { WorkspaceDialog } from './WorkspaceDialog';

export function CreateNoteDialog({
  source,
  kind,
  notes,
  config,
  gateway,
  onClose,
  onCreated,
}: {
  source: WorkspaceNote;
  kind: CreateWorkspaceNoteRequest['kind'];
  notes: WorkspaceNote[];
  config: AppConfigV2;
  gateway: VaultGateway;
  onClose(): void;
  onCreated(result: WorkspaceFileResult): void;
}) {
  const [title, setTitle] = useState(source.title.replace(/\.md$/i, ''));
  const folder =
    (kind === 'cognition' ? config.workspace.mainFolder : config.workspace.outputFolder) ?? '';
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referencePage, setReferencePage] = useState(0);
  const destination = config.vaults.find(
    (v) => v.role === (kind === 'cognition' ? 'main' : 'output'),
  );
  const knowledgeIds = config.vaults.filter((v) => v.role === 'knowledge').map((v) => v.id);
  const knowledge = notes.filter((n) => knowledgeIds.includes(n.vaultId));
  const candidates = knowledge.filter((n) =>
    `${n.title} ${n.relativePath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const validation = noteNameError(title, folder);
  const path = noteTargetPath(title, folder);
  const conflict = notes.find(
    (n) =>
      n.vaultId === destination?.id &&
      n.relativePath.toLocaleLowerCase() === path.toLocaleLowerCase(),
  );
  const label = kind === 'cognition' ? '创建认知笔记' : '创建输出笔记';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || validation || conflict || !destination || !gateway.createWorkspaceNote) return;
    setBusy(true);
    setError(null);
    const reference = (note: WorkspaceNote) => ({
      vaultId: note.vaultId,
      relativePath: note.relativePath,
      contentHash: note.contentHash,
    });
    try {
      const result = await gateway.createWorkspaceNote({
        kind,
        title,
        source: reference(source),
        references: knowledge.filter((n) => selected.includes(n.id)).map(reference),
      });
      onCreated(result);
    } catch (reason) {
      setError(toAppError(reason).message);
      setBusy(false);
    }
  }

  return (
    <WorkspaceDialog title={label} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <p className="workspace-subtle">
          来源：{source.vaultName} / {source.relativePath}
        </p>
        <p className="workspace-subtle">仅生成标题、来源链接和空正文。来源文件保持不变。</p>
        <label>
          笔记标题
          <input
            autoFocus
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入内容标题，无需 .md"
          />
        </label>
        <p className="workspace-destination">
          将创建：{destination?.name ?? '未配置目标仓库'} / {path}
        </p>
        {kind === 'output' && (
          <fieldset disabled={busy} className="reference-picker">
            <legend>Knowledge 参考资料 · 已选 {selected.length}/50（可不选）</legend>
            <input
              aria-label="搜索参考资料"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setReferencePage(0);
              }}
              placeholder="搜索标题或路径"
            />
            <div className="reference-list">
              {candidates.slice(referencePage * 6, referencePage * 6 + 6).map((note) => (
                <label key={note.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(note.id)}
                    disabled={!selected.includes(note.id) && selected.length >= 50}
                    onChange={() =>
                      setSelected((previous) =>
                        previous.includes(note.id)
                          ? previous.filter((id) => id !== note.id)
                          : [...previous, note.id],
                      )
                    }
                  />
                  <span>
                    {note.title}
                    <small>{note.relativePath}</small>
                  </span>
                </label>
              ))}
              {!candidates.length && (
                <p className="workspace-subtle">
                  暂无匹配资料；可以先创建，之后在 Obsidian 中补充链接。
                </p>
              )}
            </div>
            {candidates.length > 6 && (
              <div className="workspace-pagination">
                <button
                  type="button"
                  disabled={!referencePage}
                  onClick={() => setReferencePage((p) => p - 1)}
                >
                  上一组
                </button>
                <span>
                  {referencePage + 1} / {Math.ceil(candidates.length / 6)}
                </span>
                <button
                  type="button"
                  disabled={(referencePage + 1) * 6 >= candidates.length}
                  onClick={() => setReferencePage((p) => p + 1)}
                >
                  下一组
                </button>
              </div>
            )}
          </fieldset>
        )}
        {validation && (
          <p className="workspace-alert" role="status">
            {validation}
          </p>
        )}
        {conflict && (
          <p className="workspace-alert" role="alert">
            目标笔记已存在，请修改标题；保存目录由工作流设置决定。
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void gateway
                  .openWorkspaceNote?.(conflict.vaultId, conflict.relativePath)
                  .catch((reason) => setError(toAppError(reason).message))
              }
            >
              打开已有笔记
            </button>
          </p>
        )}
        {!destination && (
          <p role="alert" className="workspace-alert">
            请先在工作流设置中指定 {kind === 'cognition' ? 'Main' : 'Output'} 仓库。
          </p>
        )}
        {error && (
          <p role="alert" className="workspace-alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="workspace-primary"
            type="submit"
            disabled={
              busy || !!validation || !!conflict || !destination || !gateway.createWorkspaceNote
            }
          >
            {busy ? '创建中…' : '创建并打开'}
          </button>
        </footer>
      </form>
    </WorkspaceDialog>
  );
}
