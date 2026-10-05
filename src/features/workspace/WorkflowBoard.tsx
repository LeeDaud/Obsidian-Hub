import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfigV2 } from '../../domain/vault';
import type {
  WorkflowLink,
  WorkflowLinkStore,
  WorkspaceNote,
  WorkspaceSnapshot,
} from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { toAppError } from '../../domain/appError';
import { WorkspaceDialog } from './WorkspaceDialog';
import { allowedLink, confirmedLinks, focusedLinks, linkKey, noteKey } from './workflowRelations';

const stages = [
  { role: 'echo', name: 'Echo', label: '灵感' },
  { role: 'main', name: 'Main', label: '认知' },
  { role: 'output', name: 'Output', label: '输出' },
  { role: 'knowledge', name: 'Knowledge', label: '资料' },
] as const;
type Line = { key: string; path: string; reference: boolean };
export function WorkflowBoard({
  config,
  snapshot,
  gateway,
  query,
  busy,
  onPreview,
  onCreate,
  onOpen,
}: {
  config: AppConfigV2;
  snapshot: WorkspaceSnapshot | null;
  gateway: VaultGateway;
  query: string;
  busy: boolean;
  onPreview(note: WorkspaceNote): void;
  onCreate(note: WorkspaceNote): void;
  onOpen(note: WorkspaceNote): void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [store, setStore] = useState<WorkflowLinkStore>({ schemaVersion: 1, links: [] });
  const [error, setError] = useState<string | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [candidateKey, setCandidateKey] = useState('');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const roles = useMemo(() => new Map(config.vaults.map((v) => [v.id, v.role])), [config.vaults]);
  const notes = useMemo(
    () => [...(snapshot?.notes ?? [])].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [snapshot],
  );
  const byKey = useMemo(() => new Map(notes.map((n) => [noteKey(n), n])), [notes]);
  const selected = selectedKey ? byKey.get(selectedKey) : undefined;
  const links = useMemo(
    () => confirmedLinks([...(snapshot?.relations ?? []), ...store.links], roles),
    [snapshot, store, roles],
  );
  const focused = useMemo(() => (selected ? focusedLinks(selected, links) : []), [selected, links]);
  const related = new Set(focused.flatMap((l) => [noteKey(l.source), noteKey(l.target)]));
  const role = selected ? roles.get(selected.vaultId) : null;
  const targetRole =
    role === 'echo' ? 'main' : role === 'main' || role === 'knowledge' ? 'output' : null;
  const downstream = selected ? links.filter((l) => noteKey(l.source) === noteKey(selected)) : [];
  const candidates = notes.filter(
    (n) =>
      roles.get(n.vaultId) === targetRole &&
      !downstream.some((l) => noteKey(l.target) === noteKey(n)) &&
      `${n.title} ${n.relativePath}`
        .toLocaleLowerCase()
        .includes(candidateQuery.trim().toLocaleLowerCase()),
  );
  const matches = (n: WorkspaceNote) =>
    query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .every((term) =>
        [n.title, n.relativePath, ...n.aliases, ...n.tags]
          .join(' ')
          .toLocaleLowerCase()
          .includes(term),
      );
  useEffect(() => {
    let active = true;
    setLoadingLinks(true);
    Promise.resolve()
      .then(() => gateway.loadWorkflowLinks?.() ?? { schemaVersion: 1 as const, links: [] })
      .then((result) => {
        if (active) {
          setStore(result);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active) setError(toAppError(reason).message);
      })
      .finally(() => {
        if (active) setLoadingLinks(false);
      });
    return () => {
      active = false;
    };
  }, [gateway, snapshot?.scannedAt]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = board.getBoundingClientRect();
        if (root.width < 960) {
          setLines([]);
          return;
        }
        const visible = (card: HTMLButtonElement) => {
          const r = card.getBoundingClientRect();
          const parent = card.parentElement!.getBoundingClientRect();
          return r.top >= parent.top && r.bottom <= parent.bottom;
        };
        setLines(
          focused.flatMap((link) => {
            const from = cards.current.get(noteKey(link.source)),
              to = cards.current.get(noteKey(link.target));
            if (!from || !to || !visible(from) || !visible(to)) return [];
            const a = from.getBoundingClientRect(),
              b = to.getBoundingClientRect();
            const forward = a.left < b.left;
            const x1 = (forward ? a.right : a.left) - root.left,
              x2 = (forward ? b.left : b.right) - root.left;
            const y1 = a.top + a.height / 2 - root.top,
              y2 = b.top + b.height / 2 - root.top;
            const mid = (x1 + x2) / 2;
            return [
              {
                key: linkKey(link),
                path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
                reference: link.kind === 'reference',
              },
            ];
          }),
        );
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(board);
    board.addEventListener('scroll', draw, true);
    window.addEventListener('resize', draw);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      board.removeEventListener('scroll', draw, true);
      window.removeEventListener('resize', draw);
    };
  }, [focused, query, notes]);
  function locate(note: WorkspaceNote) {
    setSelectedKey(noteKey(note));
    const card = cards.current.get(noteKey(note));
    card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    card?.focus();
  }
  async function save(link: WorkflowLink, linked: boolean) {
    if (!gateway.setWorkflowLink || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await gateway.setWorkflowLink({
        link,
        linked,
        sourceHash: byKey.get(noteKey(link.source))?.contentHash ?? '',
        targetHash: byKey.get(noteKey(link.target))?.contentHash ?? '',
      });
      setStore(result);
      setLinking(false);
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="workflow-board-view" aria-label="四库流程看板">
      <div className="workflow-board-legend">
        Echo → Main → Output · Knowledge 为输出提供资料
        <br />
        实线为来源，虚线为资料；选中笔记查看已确认路径。
      </div>
      {error && (
        <p role="alert" className="workspace-alert">
          {error} 任务与笔记仍可使用；刷新可重试。
        </p>
      )}
      <div className="workflow-board" ref={boardRef}>
        {stages.map((stage) => {
          const vault = config.vaults.find((v) => v.role === stage.role);
          const status = snapshot?.vaultStatuses.find((v) => v.vaultId === vault?.id);
          const items = notes.filter((n) => roles.get(n.vaultId) === stage.role && matches(n));
          const gap =
            selected && targetRole === stage.role && role !== 'knowledge' && !downstream.length;
          return (
            <section
              className={`workflow-column role-${stage.role}`}
              key={stage.role}
              aria-label={`${stage.name} 看板`}
            >
              <header>
                <h2>
                  {stage.name} <small>{stage.label}</small>
                </h2>
                <span>
                  {vault?.name ?? '未配置'} · {items.length} 篇
                  {vault && !busy && !snapshot?.fromCache && status && !status.online
                    ? ' · 离线'
                    : ''}
                </span>
              </header>
              <div className="workflow-column-notes">
                {gap && (
                  <div className="workflow-gap">
                    <strong>尚无已确认下游</strong>
                    <span>选择已有笔记关联，或创建新笔记。</span>
                  </div>
                )}
                {items.map((note) => (
                  <button
                    type="button"
                    key={noteKey(note)}
                    ref={(element) => {
                      if (element) cards.current.set(noteKey(note), element);
                      else cards.current.delete(noteKey(note));
                    }}
                    className={`workflow-card${selectedKey === noteKey(note) ? ' is-selected' : ''}${related.has(noteKey(note)) ? ' is-related' : ''}`}
                    aria-pressed={selectedKey === noteKey(note)}
                    onClick={() => setSelectedKey(noteKey(note))}
                  >
                    <strong>{note.title}</strong>
                    <span title={note.relativePath}>{note.relativePath}</span>
                    <small>
                      {new Intl.DateTimeFormat('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(note.modifiedAt)}
                    </small>
                  </button>
                ))}
                {!items.length && (
                  <p className="workspace-subtle">
                    {busy
                      ? '读取中…'
                      : !vault
                        ? '请先配置仓库角色'
                        : status && !status.online
                          ? '仓库离线'
                          : query
                            ? '没有匹配笔记'
                            : '暂无笔记'}
                  </p>
                )}
              </div>
            </section>
          );
        })}
        <svg className="workflow-connectors" aria-hidden="true">
          {lines.map((line) => (
            <path key={line.key} d={line.path} className={line.reference ? 'is-reference' : ''} />
          ))}
        </svg>
      </div>
      <aside className="workflow-inspector" aria-label="笔记关系">
        {selected ? (
          <>
            <div className="workflow-inspector-heading">
              <div>
                <strong>{selected.title}</strong>
                <span>
                  {selected.vaultName} / {selected.relativePath}
                </span>
              </div>
              <div className="workflow-inspector-actions">
                <button type="button" onClick={() => onPreview(selected)}>
                  预览笔记
                </button>
                <button type="button" onClick={() => onOpen(selected)}>
                  Obsidian
                </button>
                {(role === 'echo' || role === 'main') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (role === 'echo' ? onPreview(selected) : onCreate(selected))}
                  >
                    {role === 'echo' ? '预览后创建认知' : '创建输出笔记'}
                  </button>
                )}
                {targetRole && (
                  <button
                    type="button"
                    disabled={busy || saving || loadingLinks || !!error || !gateway.setWorkflowLink}
                    onClick={() => {
                      setCandidateKey('');
                      setCandidateQuery('');
                      setLinking(true);
                    }}
                  >
                    关联已有笔记
                  </button>
                )}
              </div>
            </div>
            {!focused.length && (
              <p className="workspace-subtle">尚无已确认关联；相同标题不代表同一条流程。</p>
            )}
            <ul className="workflow-relations">
              {focused.map((link) => {
                const source = byKey.get(noteKey(link.source)),
                  target = byKey.get(noteKey(link.target));
                const isManual = store.links.some((l) => linkKey(l) === linkKey(link));
                const isMetadata = (snapshot?.relations ?? []).some(
                  (l) => linkKey(l) === linkKey(link),
                );
                const display = (ref: WorkflowLink['source'], note: WorkspaceNote | undefined) =>
                  note ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!matches(note)) {
                          onPreview(note);
                        } else locate(note);
                      }}
                    >
                      {note.title} · {matches(note) ? '定位' : '预览（筛选外）'}
                    </button>
                  ) : (
                    <span>
                      {config.vaults.find((v) => v.id === ref.vaultId)?.name ?? '未登记仓库'} /{' '}
                      {ref.relativePath}（
                      {snapshot?.vaultStatuses.find((v) => v.vaultId === ref.vaultId)?.online ===
                      false
                        ? '仓库离线'
                        : '断链或未索引'}
                      ）
                    </span>
                  );
                return (
                  <li key={linkKey(link)}>
                    {display(link.source, source)}
                    <span>{link.kind === 'origin' ? ' → 来源 → ' : ' ⇢ 资料 ⇢ '}</span>
                    {display(link.target, target)}
                    <small>{isMetadata ? '笔记来源字段' : 'Hub 手动关联'}</small>
                    {isManual && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save(link, false)}
                      >
                        {isMetadata ? '解除手动副本' : '解除手动关联'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="workspace-subtle">选中任一笔记，查看来源、下游和参考资料。</p>
        )}
      </aside>
      {linking && selected && targetRole && (
        <WorkspaceDialog title="关联已有笔记" onClose={() => setLinking(false)} busy={saving}>
          <p>
            {selected.title} → {targetRole === 'main' ? 'Main' : 'Output'}。只保存 Hub
            关系，不修改笔记；标题相似候选仍需确认。
          </p>
          <input
            aria-label="搜索关联候选"
            type="search"
            value={candidateQuery}
            onChange={(e) => setCandidateQuery(e.target.value)}
            placeholder="搜索标题或路径"
          />
          <div className="workflow-candidates">
            {candidates.map((note) => (
              <label key={noteKey(note)}>
                <input
                  type="radio"
                  name="workflow-target"
                  value={noteKey(note)}
                  checked={candidateKey === noteKey(note)}
                  disabled={saving}
                  onChange={() => setCandidateKey(noteKey(note))}
                />
                <span>
                  {note.title}
                  <small>
                    {note.vaultName} / {note.relativePath}
                    {note.title.toLocaleLowerCase() === selected.title.toLocaleLowerCase()
                      ? ' · 同名候选，尚未关联'
                      : ''}
                  </small>
                </span>
              </label>
            ))}
            {!candidates.length && <p>没有可关联笔记，请尝试其他搜索或创建新笔记。</p>}
          </div>
          {error && (
            <p role="alert" className="workspace-alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" disabled={saving} onClick={() => setLinking(false)}>
              取消
            </button>
            <button
              type="button"
              disabled={saving || !candidateKey || !byKey.has(candidateKey)}
              onClick={() => {
                const target = byKey.get(candidateKey);
                if (!target) return;
                const link: WorkflowLink = {
                  source: { vaultId: selected.vaultId, relativePath: selected.relativePath },
                  target: { vaultId: target.vaultId, relativePath: target.relativePath },
                  kind: role === 'knowledge' ? 'reference' : 'origin',
                };
                if (allowedLink(link, roles)) void save(link, true);
              }}
            >
              {saving ? '保存中…' : '确认关联'}
            </button>
          </footer>
        </WorkspaceDialog>
      )}
    </section>
  );
}
