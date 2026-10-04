import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfigV2, VaultRole } from '../../domain/vault';
import type {
  WorkspaceNote,
  WorkspaceSnapshot,
  WorkspaceState,
  WorkspaceTask,
  WorkspaceFileResult,
} from '../../domain/workspace';
import { toAppError } from '../../domain/appError';
import type { VaultGateway } from '../../services/vaultGateway';
import { CreateNoteDialog } from './CreateNoteDialog';
import { WorkspaceDialog } from './WorkspaceDialog';
import { NotePreviewDialog } from './NotePreviewDialog';
import { noteNameError } from './noteNaming';
import type { CrossVaultLink } from '@obsidian-hub/cross-vault-parser';

interface WorkspacePageProps {
  config: AppConfigV2;
  gateway: VaultGateway;
  onConfigChange(config: AppConfigV2): void;
}
type Filter = 'tasks' | 'echo' | 'main' | 'knowledge' | 'output' | 'recent';
const filters: Array<{ id: Filter; label: string }> = [
  { id: 'tasks', label: '所有任务' },
  { id: 'echo', label: '待处理灵感' },
  { id: 'main', label: '认知' },
  { id: 'knowledge', label: '资料' },
  { id: 'output', label: '输出' },
  { id: 'recent', label: '最近内容' },
];
const roles: Array<{ value: VaultRole; label: string }> = [
  { value: 'echo', label: 'Echo · 灵感' },
  { value: 'main', label: 'Main · 认知' },
  { value: 'knowledge', label: 'Knowledge · 资料' },
  { value: 'output', label: 'Output · 输出' },
  { value: 'hub', label: 'Hub · 旧工作目录（可选）' },
  { value: 'other', label: '其他' },
];
function matchesNote(note: WorkspaceNote, query: string) {
  const content = [note.title, note.relativePath, note.vaultName, ...note.aliases, ...note.tags]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => content.includes(term));
}
function rowsForWindow() {
  return Math.max(1, Math.min(8, Math.floor((window.innerHeight - 500) / 54)));
}

export function WorkspacePage({ config, gateway, onConfigChange }: WorkspacePageProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('tasks');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(rowsForWindow);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [mainFolder, setMainFolder] = useState(config.workspace.mainFolder ?? '');
  const [outputFolder, setOutputFolder] = useState(config.workspace.outputFolder ?? '');
  useEffect(() => {
    setMainFolder(config.workspace.mainFolder ?? '');
    setOutputFolder(config.workspace.outputFolder ?? '');
  }, [config.workspace]);
  const [creating, setCreating] = useState<{
    source: WorkspaceNote;
    kind: 'cognition' | 'output';
  } | null>(null);
  const [previewing, setPreviewing] = useState<WorkspaceNote | null>(null);
  const generation = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const roleByVault = useMemo(
    () => new Map(config.vaults.map((v) => [v.id, v.role])),
    [config.vaults],
  );
  const ready = ['echo', 'main', 'output'].every((role) =>
    config.vaults.some((v) => v.role === role),
  );

  useEffect(() => {
    if (typeof ResizeObserver !== 'undefined' && listRef.current) {
      const observer = new ResizeObserver(([entry]) => {
        if (entry.contentRect.height > 0) {
          setPageSize(Math.max(1, Math.min(12, Math.floor(entry.contentRect.height / 54))));
        }
      });
      observer.observe(listRef.current);
      return () => observer.disconnect();
    }
    const resize = () => setPageSize(rowsForWindow());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const refresh = useCallback(async () => {
    if (!gateway.scanWorkspace) return;
    const id = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const cached = await gateway.loadWorkspaceCache?.();
      if (cached && id === generation.current) setSnapshot(cached);
    } catch {
      /* A cache failure must not block a fresh scan. */
    }
    try {
      const [nextSnapshot, nextState] = await Promise.all([
        gateway.scanWorkspace(),
        gateway.loadWorkspaceState?.() ?? Promise.resolve(null),
      ]);
      if (id === generation.current) {
        setSnapshot(nextSnapshot);
        setState(nextState);
      }
    } catch (reason) {
      if (id === generation.current) setError(toAppError(reason).message);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }, [gateway]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [config, refresh]);

  function selectFilter(next: Filter) {
    setFilter(next);
    setPage(0);
    setQuery('');
  }
  async function assignRole(vaultId: string, role: VaultRole | null) {
    setSaving(true);
    setError(null);
    try {
      const vaults = config.vaults.map((v) => ({
        ...v,
        role: v.id === vaultId ? role : role && role !== 'other' && v.role === role ? null : v.role,
      }));
      const hubStillAssigned = vaults.some(
        (v) => v.id === config.workspace.hubVaultId && v.role === 'hub',
      );
      onConfigChange(
        await gateway.saveConfig({
          ...config,
          vaults,
          workspace: {
            ...config.workspace,
            hubVaultId: hubStillAssigned ? config.workspace.hubVaultId : null,
            initializedAt: hubStillAssigned ? config.workspace.initializedAt : null,
            mainFolder:
              vaults.find((v) => v.role === 'main')?.id ===
              config.vaults.find((v) => v.role === 'main')?.id
                ? config.workspace.mainFolder
                : '',
            outputFolder:
              vaults.find((v) => v.role === 'output')?.id ===
              config.vaults.find((v) => v.role === 'output')?.id
                ? config.workspace.outputFolder
                : '',
          },
        }),
      );
      setMessage('仓库角色已保存。');
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setSaving(false);
    }
  }
  async function saveWorkflow() {
    const validation = noteNameError('工作流', mainFolder) ?? noteNameError('工作流', outputFolder);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onConfigChange(
        await gateway.saveConfig({
          ...config,
          workspace: { ...config.workspace, mainFolder, outputFolder },
        }),
      );
      setShowSetup(false);
      setMessage('工作流已保存，新笔记将自动进入下一阶段仓库。');
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setSaving(false);
    }
  }
  async function openNote(note: { vaultId: string; relativePath: string }) {
    try {
      await gateway.openWorkspaceNote?.(note.vaultId, note.relativePath);
    } catch (reason) {
      setError(toAppError(reason).message);
    }
  }
  async function created(result: WorkspaceFileResult) {
    setCreating(null);
    setMessage('已创建 ' + result.relativePath + '，正文由你在 Obsidian 中完成。');
    await refresh();
    // Opening failure must never cause a second creation attempt.
    await openNote(result);
  }
  async function updateTask(task: WorkspaceTask) {
    if (!gateway.setWorkspaceTaskComplete) return;
    setSaving(true);
    setError(null);
    try {
      await gateway.setWorkspaceTaskComplete(
        task.vaultId,
        task.relativePath,
        task.lineNumber,
        task.contentHash,
        !task.complete,
      );
      await refresh();
      setMessage('已更新来源笔记中的任务。');
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setSaving(false);
    }
  }
  async function toggleReviewed(note: WorkspaceNote) {
    if (!gateway.setEchoReviewed) return;
    setSaving(true);
    try {
      setState(await gateway.setEchoReviewed(note.id, !(state?.reviewed ?? []).includes(note.id)));
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setSaving(false);
    }
  }

  const notes = useMemo(
    () => [...(snapshot?.notes ?? [])].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [snapshot],
  );
  const noteModifiedAt = useMemo(
    () => new Map(notes.map((note) => [`${note.vaultId}:${note.relativePath}`, note.modifiedAt])),
    [notes],
  );
  const tasks = useMemo(
    () =>
      [...(snapshot?.tasks ?? [])].sort(
        (a, b) =>
          (noteModifiedAt.get(`${b.vaultId}:${b.relativePath}`) ?? 0) -
            (noteModifiedAt.get(`${a.vaultId}:${a.relativePath}`) ?? 0) ||
          a.lineNumber - b.lineNumber,
      ),
    [noteModifiedAt, snapshot?.tasks],
  );
  const inbox = notes.filter(
    (n) => roleByVault.get(n.vaultId) === 'echo' && !(state?.reviewed ?? []).includes(n.id),
  );
  const searching = !!query.trim();
  const taskView = !searching && filter === 'tasks';
  const visibleNotes = searching
    ? notes.filter((n) => matchesNote(n, query))
    : filter === 'echo'
      ? inbox
      : filter === 'recent'
        ? notes
        : notes.filter((n) => roleByVault.get(n.vaultId) === filter);
  const visibleTasks = tasks;
  const total = taskView ? visibleTasks.length : visibleNotes.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const offset = currentPage * pageSize;
  const recent = notes[0];
  const disabled = busy || saving;
  const online = snapshot?.vaultStatuses.filter((s) => s.online).length ?? 0;
  const failures = snapshot?.vaultStatuses.reduce((count, item) => count + item.readErrors, 0) ?? 0;

  function previewCrossVaultLink(link: CrossVaultLink) {
    const normalized = (value: string) => value.replace(/\.md$/i, '').toLocaleLowerCase();
    const target = notes.find(
      (note) =>
        (link.vaultId
          ? note.vaultId === link.vaultId
          : note.vaultName.toLocaleLowerCase() === link.vaultName.toLocaleLowerCase()) &&
        normalized(note.relativePath) === normalized(link.notePath),
    );
    if (target) setPreviewing(target);
    else setError('跨库链接目标不在当前工作台索引中，请刷新后重试。');
  }

  function noteRow(note: WorkspaceNote) {
    const role = roleByVault.get(note.vaultId);
    return (
      <li className="workspace-row" key={note.id}>
        <span className={'workspace-note-mark role-' + role} aria-hidden="true">
          {role === 'echo'
            ? 'E'
            : role === 'main'
              ? 'M'
              : role === 'knowledge'
                ? 'K'
                : role === 'output'
                  ? 'O'
                  : '·'}
        </span>
        <div className="workspace-row-copy">
          <button
            className="workspace-note-title"
            type="button"
            onClick={() => setPreviewing(note)}
            onDoubleClick={() => void openNote(note)}
            title={note.title}
          >
            {note.title}
          </button>
          <span title={note.vaultName + ' / ' + note.relativePath}>
            {note.vaultName} / {note.relativePath}
          </span>
        </div>
        <div className="workspace-row-actions">
          {role === 'echo' && (
            <button type="button" onClick={() => setPreviewing(note)}>
              预览
            </button>
          )}
          {role === 'main' && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCreating({ source: note, kind: 'output' })}
            >
              创建输出笔记
            </button>
          )}
        </div>
      </li>
    );
  }
  function taskRow(task: WorkspaceTask) {
    const source = notes.find(
      (note) => note.vaultId === task.vaultId && note.relativePath === task.relativePath,
    );
    return (
      <li className="workspace-task" key={task.id}>
        <input
          type="checkbox"
          aria-label={'完成 ' + task.text}
          checked={task.complete}
          disabled={disabled}
          onChange={() => void updateTask(task)}
        />
        <div className="workspace-row-copy">
          <button
            type="button"
            className={`workspace-task-title${task.complete ? ' is-complete' : ''}`}
            title={task.text}
            disabled={!source}
            onClick={() => source && setPreviewing(source)}
          >
            {task.text}
          </button>
          <span title={task.relativePath}>
            {task.vaultName} / {task.relativePath}:{task.lineNumber}
          </span>
        </div>
        <div className="workspace-row-actions">
          <button type="button" onClick={() => void openNote(task)}>
            Obsidian
          </button>
        </div>
      </li>
    );
  }

  return (
    <section className="workspace-page" aria-label="知识工作台">
      <header className="workspace-page-header">
        <div>
          <span className="workspace-eyebrow">
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </span>
          <h1>
            知识工作台<span className="workspace-version">2.0</span>
          </h1>
        </div>
        <div className="workspace-header-actions">
          <input
            aria-label="搜索全部笔记"
            type="search"
            value={query}
            placeholder="搜索标题、路径、别名和标签…"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <button type="button" onClick={() => setShowSetup(true)}>
            工作流设置
          </button>
          <button type="button" disabled={disabled} onClick={() => void refresh()}>
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>
      {!ready && (
        <div className="workspace-setup-hint">
          <span>指定 Echo、Main 和 Output，开始直接创建笔记。Knowledge 可选，无需 Hub 仓库。</span>
          <button type="button" onClick={() => setShowSetup(true)}>
            配置工作流
          </button>
        </div>
      )}
      {(error || message) && (
        <div
          className={error ? 'workspace-alert' : 'workspace-message'}
          role={error ? 'alert' : 'status'}
        >
          <span>{error ?? message}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => {
              setError(null);
              setMessage(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      <section className="workspace-focus" aria-label="继续工作">
        <div className="workspace-focus-copy">
          <span className="workspace-eyebrow">继续最近编辑</span>
          <strong title={recent?.title}>{recent?.title ?? '从一个想法开始'}</strong>
          <span className="workspace-subtle">
            {recent
              ? recent.vaultName + ' / ' + recent.relativePath
              : '选一条 Echo 灵感，在 Main 开始自己的思考。'}
          </span>
        </div>
        <button
          type="button"
          className="workspace-primary"
          onClick={() => (recent ? void openNote(recent) : selectFilter('echo'))}
        >
          {recent ? '在 Obsidian 打开 ↗' : '查看灵感 →'}
        </button>
      </section>
      <section className="workspace-worklist" aria-label="工作清单">
        <div className="workspace-list-heading">
          <h2>{searching ? '搜索结果' : '工作清单'}</h2>
          <span>
            {tasks.filter((task) => !task.complete).length} 项待办 · {inbox.length} 条待处理灵感
          </span>
        </div>
        <div className="workspace-filters" aria-label="清单筛选">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={!searching && filter === item.id}
              onClick={() => selectFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ul ref={listRef} className="workspace-list">
          {taskView
            ? visibleTasks.slice(offset, offset + pageSize).map(taskRow)
            : visibleNotes.slice(offset, offset + pageSize).map(noteRow)}
        </ul>
        {!total && (
          <div className="workspace-empty">
            <strong>
              {busy ? '正在读取工作空间…' : searching ? '没有找到匹配的笔记' : '这里暂时没有内容'}
            </strong>
            <p>可以刷新工作台，或尝试其他筛选。</p>
          </div>
        )}
        <footer className="workspace-pagination">
          <span>
            {snapshot?.fromCache ? '缓存 · 刷新中' : '共 ' + total + ' 条'}
            {taskView ? ' · 按来源笔记最近修改排序' : ' · 按最近修改排序'}
          </span>
          <div>
            <button
              type="button"
              aria-label="上一页"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              type="button"
              aria-label="下一页"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </button>
          </div>
        </footer>
      </section>
      <footer className="workspace-bottom">
        <div className="workspace-flow" aria-label="知识流程">
          <button type="button" onClick={() => selectFilter('echo')}>
            Echo 灵感
          </button>
          <span>→</span>
          <button type="button" onClick={() => selectFilter('main')}>
            Main 认知
          </button>
          <span>+</span>
          <button type="button" onClick={() => selectFilter('knowledge')}>
            Knowledge 资料
          </button>
          <span>→</span>
          <button type="button" onClick={() => selectFilter('output')}>
            Output 输出
          </button>
        </div>
        <button type="button" className="workspace-connection" onClick={() => setShowSetup(true)}>
          {busy || snapshot?.fromCache
            ? '检查仓库中…'
            : online + '/' + config.vaults.length + ' 个仓库在线'}
          {failures ? ' · 部分文件读取失败' : ''}
        </button>
      </footer>
      {showSetup && (
        <WorkspaceDialog title="工作流设置" onClose={() => setShowSetup(false)} busy={saving}>
          <p className="workspace-subtle">
            指定已有仓库的用途。分配已占用角色会替换原分配；不移动文件，也不创建目录。
          </p>
          {!config.vaults.length && <p>请先从顶部“仓库管理”添加已有仓库。</p>}
          <div className="workspace-role-grid">
            {config.vaults.map((vault) => {
              const status = snapshot?.vaultStatuses.find((s) => s.vaultId === vault.id);
              return (
                <label key={vault.id}>
                  <span>
                    {vault.name}
                    <small>
                      {busy || !snapshot || snapshot.fromCache
                        ? '检查中'
                        : status?.online
                          ? status.readErrors
                            ? '部分读取失败'
                            : '在线'
                          : '离线'}
                    </small>
                  </span>
                  <select
                    disabled={saving}
                    aria-label={vault.name + ' 的角色'}
                    value={vault.role ?? ''}
                    onChange={(event) =>
                      void assignRole(vault.id, (event.target.value || null) as VaultRole | null)
                    }
                  >
                    <option value="">未指定</option>
                    {roles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="workspace-destination">
            Echo → {config.vaults.find((v) => v.role === 'main')?.name ?? '未配置 Main'} →{' '}
            {config.vaults.find((v) => v.role === 'output')?.name ?? '未配置 Output'}
          </p>
          <label>
            Main 默认保存目录
            <input
              value={mainFolder}
              disabled={saving || !config.vaults.some((v) => v.role === 'main')}
              onChange={(event) => setMainFolder(event.target.value)}
              placeholder="留空为根目录；填写 Main 仓库内已有相对目录"
            />
          </label>
          <label>
            Output 默认保存目录
            <input
              value={outputFolder}
              disabled={saving || !config.vaults.some((v) => v.role === 'output')}
              onChange={(event) => setOutputFolder(event.target.value)}
              placeholder="留空为根目录；填写 Output 仓库内已有相对目录"
            />
          </label>
          {error && (
            <p role="alert" className="workspace-alert">
              {error}
            </p>
          )}
          <p className="workspace-subtle">
            新笔记直接保存到 Main／Output，旧 Hub 草稿仍可从“最近内容”或搜索打开。跨库链接需在
            Obsidian 中启用 Bridge。
          </p>
          <footer>
            <button type="button" disabled={saving} onClick={() => void saveWorkflow()}>
              保存工作流
            </button>
          </footer>
        </WorkspaceDialog>
      )}
      {creating && (
        <CreateNoteDialog
          source={creating.source}
          kind={creating.kind}
          notes={notes}
          config={config}
          gateway={gateway}
          onClose={() => setCreating(null)}
          onCreated={(result) => void created(result)}
        />
      )}
      {previewing && (
        <NotePreviewDialog
          note={previewing}
          gateway={gateway}
          onClose={() => setPreviewing(null)}
          onOpen={() => void openNote(previewing)}
          onLink={previewCrossVaultLink}
          actions={
            roleByVault.get(previewing.vaultId) === 'echo' ? (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void toggleReviewed(previewing)}
                >
                  {state?.reviewed.includes(previewing.id) ? '恢复待处理' : '标为已阅'}
                </button>
                <button
                  type="button"
                  className="workspace-primary"
                  disabled={disabled}
                  onClick={() => {
                    const source = previewing;
                    setPreviewing(null);
                    setCreating({ source, kind: 'cognition' });
                  }}
                >
                  添加认知笔记
                </button>
              </>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
