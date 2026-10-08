import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfigV2, VaultRole } from '../../domain/vault';
import type {
  WorkflowLink,
  WorkflowLinkRequest,
  WorkflowLinkStore,
  WorkspaceNote,
  WorkspaceSnapshot,
} from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { toAppError } from '../../domain/appError';
import {
  allowedLink,
  automaticLinks,
  confirmedLinks,
  focusedLinks,
  linkKey,
  noteKey,
} from './workflowRelations';

const stages = [
  { role: 'echo', name: 'Echo', label: '灵感' },
  { role: 'main', name: 'Main', label: '认知' },
  { role: 'output', name: 'Output', label: '输出' },
  { role: 'knowledge', name: 'Knowledge', label: '资料' },
] as const;
type Line = {
  key: string;
  path: string;
  reference: boolean;
  pending: boolean;
  automatic: boolean;
  direct: boolean;
};
function ref(note: WorkspaceNote) {
  return { vaultId: note.vaultId, relativePath: note.relativePath };
}
function matchNote(note: WorkspaceNote, query: string) {
  const text = [note.title, note.relativePath, note.vaultName, ...note.aliases, ...note.tags]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
}
function relationFor(
  a: WorkspaceNote,
  b: WorkspaceNote,
  roles: Map<string, VaultRole | null | undefined>,
): WorkflowLink | null {
  for (const [source, target] of [
    [a, b],
    [b, a],
  ]) {
    const link: WorkflowLink = {
      source: ref(source),
      target: ref(target),
      kind: roles.get(source.vaultId) === 'knowledge' ? 'reference' : 'origin',
    };
    if (allowedLink(link, roles)) return link;
  }
  return null;
}
function actionLabel(
  selectedRole: VaultRole | null | undefined,
  candidateRole: VaultRole | null | undefined,
) {
  if (candidateRole === 'echo') return '关联来源灵感';
  if (candidateRole === 'knowledge') return '引用此资料';
  if (candidateRole === 'main') return selectedRole === 'output' ? '关联来源认知' : '关联此认知';
  return selectedRole === 'knowledge' ? '关联引用此资料的输出' : '关联此输出';
}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<WorkflowLinkRequest[]>([]);
  const pending = pendingRequests[0] ?? null;
  const setPending = (value: WorkflowLinkRequest | null) =>
    setPendingRequests(value ? [value] : []);
  const [associationMode, setAssociationMode] = useState(false);
  const [relatedOnly, setRelatedOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [columnQueries, setColumnQueries] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const saveLock = useRef(false);
  const linkGeneration = useRef(0);
  const candidateButton = useRef<HTMLButtonElement | null>(null);
  const roles = useMemo(() => new Map(config.vaults.map((v) => [v.id, v.role])), [config.vaults]);
  const notes = useMemo(
    () => [...(snapshot?.notes ?? [])].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [snapshot],
  );
  const byKey = useMemo(() => new Map(notes.map((n) => [noteKey(n), n])), [notes]);
  const selected = selectedKey ? byKey.get(selectedKey) : undefined;
  const role = selected ? roles.get(selected.vaultId) : null;
  const automatic = useMemo(() => automaticLinks(snapshot, config), [snapshot, config]);
  const automaticKeys = useMemo(() => new Set(automatic.links.map(linkKey)), [automatic.links]);
  const links = useMemo(
    () =>
      confirmedLinks([...(snapshot?.relations ?? []), ...store.links, ...automatic.links], roles),
    [snapshot, store, roles, automatic.links],
  );
  const linkedKeys = useMemo(
    () =>
      new Set(confirmedLinks([...(snapshot?.relations ?? []), ...store.links], roles).map(linkKey)),
    [snapshot?.relations, store.links, roles],
  );
  const focused = useMemo(
    () => (selected ? focusedLinks(selected, links, expanded) : []),
    [selected, links, expanded],
  );
  const related = new Set(focused.flatMap((l) => [noteKey(l.source), noteKey(l.target)]));
  const pendingSource = pending ? byKey.get(noteKey(pending.link.source)) : undefined;
  const pendingTarget = pending ? byKey.get(noteKey(pending.link.target)) : undefined;
  const pendingIssue =
    pendingRequests
      .map((request) => {
        const source = byKey.get(noteKey(request.link.source)),
          target = byKey.get(noteKey(request.link.target));
        if (!selected || !source || !target) return '关联笔记已移走或未被读取，请刷新后重新选择。';
        if (!allowedLink(request.link, roles)) return '仓库角色已变化，请重新选择关联对象。';
        if (linkedKeys.has(linkKey(request.link))) return '这两篇笔记已经关联。';
        if (source.contentHash !== request.sourceHash || target.contentHash !== request.targetHash)
          return '笔记已变化，请重新选择关联对象。';
        return null;
      })
      .find(Boolean) ?? null;
  const blocked =
    busy ||
    saving ||
    loadingLinks ||
    !!loadError ||
    (!gateway.setWorkflowLink && !gateway.setWorkflowLinks) ||
    !!snapshot?.fromCache;
  const drawnLinks = useMemo(
    () => [
      ...focused.map((link) => ({ link, pending: false })),
      ...pendingRequests
        .filter((request) => !linkedKeys.has(linkKey(request.link)))
        .map((request) => ({ link: request.link, pending: true })),
    ],
    [focused, pendingRequests, linkedKeys],
  );

  useEffect(() => {
    if (saveLock.current) return;
    let active = true;
    const generation = ++linkGeneration.current;
    setLoadingLinks(true);
    Promise.resolve()
      .then(() => gateway.loadWorkflowLinks?.() ?? { schemaVersion: 1 as const, links: [] })
      .then((result) => {
        if (active && generation === linkGeneration.current) {
          setStore(result);
          setLoadError(null);
        }
      })
      .catch((reason) => {
        if (active && generation === linkGeneration.current)
          setLoadError(toAppError(reason).message);
      })
      .finally(() => {
        if (active && generation === linkGeneration.current) setLoadingLinks(false);
      });
    return () => {
      active = false;
    };
  }, [gateway, snapshot?.scannedAt]);

  useEffect(() => {
    if (!pending) return;
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        saveLock.current ||
        (event.target instanceof Element && event.target.closest('dialog[open]'))
      )
        return;
      event.preventDefault();
      setPending(null);
      setSaveError(null);
      candidateButton.current?.focus();
    };
    window.addEventListener('keydown', cancel);
    confirmRef.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      const toolbar = toolbarRef.current;
      const area = toolbar?.closest<HTMLElement>('.workspace-page');
      const legend = toolbar?.previousElementSibling;
      if (!toolbar || !area || !legend) return;
      const gap = parseFloat(getComputedStyle(toolbar.parentElement!).rowGap) || 0;
      const padding = parseFloat(getComputedStyle(area).paddingTop) || 0;
      area.scrollTop +=
        legend.getBoundingClientRect().bottom + gap - area.getBoundingClientRect().top - padding;
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', cancel);
    };
  }, [pending]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = board.getBoundingClientRect();
        if (window.innerWidth <= 1050) {
          setLines([]);
          return;
        }
        const visible = (card: HTMLDivElement) => {
          const r = card.getBoundingClientRect();
          const viewport = card.closest('.workflow-column-notes')!.getBoundingClientRect();
          return r.top >= viewport.top && r.bottom <= viewport.bottom;
        };
        setLines(
          drawnLinks.flatMap(({ link, pending: draft }) => {
            const from = cards.current.get(noteKey(link.source)),
              to = cards.current.get(noteKey(link.target));
            if (!from || !to || !visible(from) || !visible(to)) return [];
            const a = from.getBoundingClientRect(),
              b = to.getBoundingClientRect(),
              forward = a.left < b.left;
            const x1 = (forward ? a.right : a.left) - root.left,
              x2 = (forward ? b.left : b.right) - root.left;
            const y1 = a.top + a.height / 2 - root.top,
              y2 = b.top + b.height / 2 - root.top,
              mid = (x1 + x2) / 2;
            const direct =
              roles.get(link.source.vaultId) === 'echo' &&
              roles.get(link.target.vaultId) === 'output';
            const gutter = root.height - 5;
            return [
              {
                key: (draft ? 'pending:' : '') + linkKey(link),
                path: direct
                  ? `M ${x1} ${y1} C ${x1 + 14} ${y1}, ${x1 + 14} ${gutter}, ${x1 + 14} ${gutter} L ${x2 - 14} ${gutter} C ${x2 - 14} ${gutter}, ${x2 - 14} ${y2}, ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
                reference: link.kind === 'reference',
                pending: draft,
                automatic:
                  automaticKeys.has(linkKey(link)) &&
                  !(snapshot?.relations ?? []).some((item) => linkKey(item) === linkKey(link)) &&
                  !store.links.some((item) => linkKey(item) === linkKey(link)),
                direct:
                  roles.get(link.source.vaultId) === 'echo' &&
                  roles.get(link.target.vaultId) === 'output',
              },
            ];
          }),
        );
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(board);
    board
      .querySelectorAll('.workflow-column-notes, .workflow-card')
      .forEach((card) => observer?.observe(card));
    board.addEventListener('scroll', draw, true);
    window.addEventListener('resize', draw);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      board.removeEventListener('scroll', draw, true);
      window.removeEventListener('resize', draw);
    };
  }, [
    drawnLinks,
    query,
    columnQueries,
    notes,
    selectedKey,
    automaticKeys,
    snapshot?.relations,
    store.links,
    roles,
  ]);

  useEffect(() => {
    const pinned = [
      selectedKey,
      ...pendingRequests.flatMap((request) => [
        noteKey(request.link.source),
        noteKey(request.link.target),
      ]),
    ];
    for (const key of new Set(pinned)) {
      if (!key) continue;
      const card = cards.current.get(key);
      const viewport = card?.closest<HTMLElement>('.workflow-column-notes');
      if (!card || !viewport) continue;
      const bounds = card.getBoundingClientRect(),
        view = viewport.getBoundingClientRect();
      if (bounds.top < view.top) viewport.scrollTop += bounds.top - view.top - 10;
      else if (bounds.bottom > view.bottom) viewport.scrollTop += bounds.bottom - view.bottom + 10;
    }
  }, [selectedKey, pendingRequests, query, columnQueries, relatedOnly]);

  useEffect(() => {
    if (relatedOnly && !associationMode) {
      boardRef.current
        ?.querySelectorAll<HTMLElement>('.workflow-column-notes')
        .forEach((column) => {
          column.scrollTop = 0;
        });
    }
  }, [selectedKey, relatedOnly, associationMode]);

  function selectNote(note: WorkspaceNote) {
    if (saveLock.current) return;
    setSelectedKey(noteKey(note));
    setAssociationMode(false);
    setPending(null);
    setSaveError(null);
    setMessage(null);
  }
  function locate(note: WorkspaceNote) {
    selectNote(note);
    const card = cards.current.get(noteKey(note));
    card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    card?.querySelector<HTMLButtonElement>('.workflow-card-select')?.focus({ preventScroll: true });
  }
  function choose(link: WorkflowLink, button: HTMLButtonElement) {
    if (blocked || saveLock.current || linkedKeys.has(linkKey(link))) return;
    const source = byKey.get(noteKey(link.source)),
      target = byKey.get(noteKey(link.target));
    if (!source || !target) return;
    candidateButton.current = button;
    const next: WorkflowLinkRequest = {
      link,
      linked: true,
      sourceHash: source.contentHash,
      targetHash: target.contentHash,
    };
    setPendingRequests((requests) => {
      const previous = requests.find((request) => linkKey(request.link) === linkKey(link));
      if (previous) {
        if (previous.sourceHash !== next.sourceHash || previous.targetHash !== next.targetHash)
          return requests.map((request) =>
            linkKey(request.link) === linkKey(link) ? next : request,
          );
        return requests.filter((request) => linkKey(request.link) !== linkKey(link));
      }
      return requests.length < 50 ? [...requests, next] : requests;
    });
    setSaveError(null);
    setMessage(null);
  }
  function cancelPending() {
    if (!saveLock.current) {
      setPending(null);
      setSaveError(null);
      candidateButton.current?.focus();
    }
  }
  async function save(request: WorkflowLinkRequest) {
    if (!gateway.setWorkflowLink || saveLock.current || blocked || (request.linked && pendingIssue))
      return;
    linkGeneration.current += 1;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const result = await gateway.setWorkflowLink(request);
      setStore(result);
      setPending(null);
      setMessage(request.linked ? '关联已保存。' : '手动关联已解除。');
      candidateButton.current?.focus({ preventScroll: true });
    } catch (reason) {
      setSaveError(toAppError(reason).message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  async function saveBatch() {
    if (!pendingRequests.length || pendingIssue || blocked || saveLock.current) return;
    if (pendingRequests.length === 1 && !gateway.setWorkflowLinks) {
      await save(pendingRequests[0]);
      return;
    }
    if (!gateway.setWorkflowLinks) {
      setSaveError('当前环境不支持批量关联，请一次选择一条。');
      return;
    }
    linkGeneration.current += 1;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      setStore(await gateway.setWorkflowLinks(pendingRequests));
      setPending(null);
      setAssociationMode(false);
      setMessage('关联已保存。');
    } catch (reason) {
      setSaveError(toAppError(reason).message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  const downstreamRole = role === 'echo' ? 'main' : role === 'main' ? 'output' : null;
  const downstream = selected ? links.filter((l) => noteKey(l.source) === noteKey(selected)) : [];
  const groups = selected
    ? [
        {
          label: '来源',
          items: focused.filter(
            (link) =>
              linkedKeys.has(linkKey(link)) &&
              link.kind === 'origin' &&
              noteKey(link.target) === noteKey(selected),
          ),
        },
        {
          label: '下游',
          items: focused.filter(
            (link) => linkedKeys.has(linkKey(link)) && noteKey(link.source) === noteKey(selected),
          ),
        },
        {
          label: '参考资料',
          items: focused.filter(
            (link) =>
              linkedKeys.has(linkKey(link)) &&
              link.kind === 'reference' &&
              noteKey(link.target) === noteKey(selected),
          ),
        },
        { label: '笔记链接', items: focused.filter((link) => !linkedKeys.has(linkKey(link))) },
        {
          label: '上下游链',
          items: focused.filter(
            (link) =>
              linkedKeys.has(linkKey(link)) &&
              noteKey(link.source) !== noteKey(selected) &&
              noteKey(link.target) !== noteKey(selected),
          ),
        },
      ]
    : [];
  function endpoint(note: WorkspaceNote | undefined, label: string) {
    return (
      <div className="workflow-pending-endpoint">
        <small>{label}</small>
        <strong>{note?.title ?? '笔记不可用'}</strong>
        <span>{note ? `${note.vaultName} / ${note.relativePath}` : '请刷新后重新选择'}</span>
        {note && (
          <button type="button" disabled={saving} onClick={() => onPreview(note)}>
            预览{label}
          </button>
        )}
      </div>
    );
  }
  function cardVisible(note: WorkspaceNote) {
    const key = noteKey(note);
    const pinned =
      key === selectedKey ||
      pendingRequests.some((request) =>
        [request.link.source, request.link.target].some((ref) => noteKey(ref) === key),
      );
    if (pinned) return true;
    if (relatedOnly && selected && !associationMode) return related.has(key);
    return (
      matchNote(note, query) && matchNote(note, columnQueries[roles.get(note.vaultId) ?? ''] ?? '')
    );
  }
  return (
    <section className="workflow-board-view" aria-label="四库流程看板">
      <div className="workflow-board-legend">
        Echo → Main → Output · Echo 可直达 Output · Knowledge 为输出提供资料
        <br />
        浏览时查看关系；进入关联模式后可多选。实线为来源，虚线为资料，点线为正文链接。
      </div>
      <div
        className="workflow-association-toolbar"
        ref={toolbarRef}
        role="region"
        aria-label="看板关联操作"
      >
        <div className="workflow-toolbar-heading">
          {selected ? (
            <>
              <div className="workflow-current-note">
                <small>当前笔记 · {stages.find((s) => s.role === role)?.name}</small>
                <strong>{selected.title}</strong>
                <span>
                  {selected.vaultName} / {selected.relativePath}
                </span>
              </div>
              <div className="workflow-inspector-actions">
                <button
                  type="button"
                  aria-pressed={associationMode}
                  disabled={busy || saving}
                  onClick={() => {
                    setAssociationMode((value) => !value);
                    setPending(null);
                    setSaveError(null);
                  }}
                >
                  {associationMode ? '退出关联' : '关联笔记'}
                </button>
                <button
                  type="button"
                  aria-pressed={relatedOnly}
                  disabled={saving}
                  onClick={() => setRelatedOnly((value) => !value)}
                >
                  只看相关笔记
                </button>
                <button
                  type="button"
                  aria-pressed={expanded}
                  disabled={saving}
                  onClick={() => setExpanded((value) => !value)}
                >
                  展开上下游
                </button>
                <button type="button" disabled={saving} onClick={() => onPreview(selected)}>
                  预览笔记
                </button>
                <button type="button" disabled={saving} onClick={() => onOpen(selected)}>
                  Obsidian
                </button>
                {(role === 'echo' || role === 'main') && (
                  <button
                    type="button"
                    disabled={busy || saving}
                    onClick={() => (role === 'echo' ? onPreview(selected) : onCreate(selected))}
                  >
                    {role === 'echo' ? '预览后创建认知' : '创建输出笔记'}
                  </button>
                )}
                {role === 'echo' && (
                  <button
                    type="button"
                    disabled={busy || saving}
                    onClick={() => onPreview(selected)}
                  >
                    预览后直接输出
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="workspace-subtle">
              点击一篇笔记，直接在四列中选择它的来源、下游或参考资料。
            </span>
          )}
        </div>
        {pending ? (
          <div className="workflow-pending" role="region" aria-label="待确认关联">
            <div className="workflow-pending-pair">
              {endpoint(pendingSource, pending.link.kind === 'reference' ? '资料' : '来源')}
              <span className="workflow-pending-arrow" aria-hidden="true">
                →
              </span>
              {endpoint(pendingTarget, pending.link.kind === 'reference' ? '输出' : '下游')}
            </div>
            <div className="workflow-pending-actions">
              <span>已选 {pendingRequests.length}/50 条 · 统一确认</span>
              <ul className="workflow-batch-list">
                {pendingRequests.slice(1).map((request) => (
                  <li key={linkKey(request.link)}>
                    {byKey.get(noteKey(request.link.source))?.title} →{' '}
                    {byKey.get(noteKey(request.link.target))?.title}
                  </li>
                ))}
              </ul>
              <button
                ref={confirmRef}
                type="button"
                className="workspace-primary"
                disabled={blocked || !!pendingIssue}
                onClick={() => void saveBatch()}
              >
                {saving ? '保存中…' : '确认关联'}
              </button>
              <button type="button" disabled={saving} onClick={cancelPending}>
                取消
              </button>
            </div>
          </div>
        ) : (
          selected && (
            <p className="workflow-association-hint">
              {associationMode
                ? '在可关联列中选择多篇笔记，统一确认；再次点击可取消选择。'
                : '当前为浏览模式，来源、下游和资料均可查看；需要补充关系时点击关联笔记。'}
            </p>
          )
        )}
        {loadingLinks && (
          <p role="status" className="workspace-subtle">
            正在读取关联…
          </p>
        )}
        {loadError && (
          <p role="alert" className="workspace-alert">
            {loadError} 关联暂不可用，请刷新工作台；笔记仍可浏览。
          </p>
        )}
        {(saveError || pendingIssue) && (
          <p role="alert" className="workspace-alert">
            {saveError ?? pendingIssue}
          </p>
        )}
        {message && (
          <p role="status" className="workspace-message">
            {message}
          </p>
        )}
      </div>
      <div
        className={`workflow-board${relatedOnly && selected && !associationMode ? ' is-focused' : ''}`}
        ref={boardRef}
      >
        {stages.map((stage) => {
          const vault = config.vaults.find((v) => v.role === stage.role),
            status = snapshot?.vaultStatuses.find((v) => v.vaultId === vault?.id);
          const stageNotes = notes.filter((n) => roles.get(n.vaultId) === stage.role);
          const items = stageNotes.filter(cardVisible);
          // Show a search affordance even for an empty but eligible registered vault.
          const stageEligible =
            associationMode &&
            !!selected &&
            !!vault &&
            !!relationFor(
              selected,
              { ...selected, vaultId: vault.id, relativePath: 'candidate.md' },
              roles,
            );
          const gap = selected && downstreamRole === stage.role && !downstream.length;
          return (
            <section
              className={`workflow-column role-${stage.role}${stageEligible ? ' is-associable' : ''}`}
              key={stage.role}
              aria-label={`${stage.name} 看板`}
            >
              <header>
                <h2>
                  {vault?.name ?? stage.name}{' '}
                  <small>
                    {stage.name} · {stage.label}
                  </small>
                  {stageEligible && <span className="workflow-column-badge">可关联</span>}
                </h2>
                <span>
                  {vault?.name ?? '未配置'} · {items.length}/{stageNotes.length} 篇
                  {vault && !busy && !snapshot?.fromCache && status && !status.online
                    ? ' · 离线'
                    : ''}
                </span>
                {stageEligible && (
                  <input
                    type="search"
                    aria-label={`搜索 ${stage.name} 关联笔记`}
                    placeholder={`搜索 ${stage.name} 笔记…`}
                    value={columnQueries[stage.role] ?? ''}
                    disabled={saving}
                    onChange={(e) =>
                      setColumnQueries((current) => ({ ...current, [stage.role]: e.target.value }))
                    }
                  />
                )}
              </header>
              <div className="workflow-column-notes">
                {gap && (
                  <div className="workflow-gap">
                    <strong>尚无已确认下游</strong>
                    <span>在本列卡片上选择关联，或创建新笔记。</span>
                  </div>
                )}
                {items.map((note) => {
                  const link = selected ? relationFor(selected, note, roles) : null;
                  const already = !!link && linkedKeys.has(linkKey(link));
                  const draft = pendingRequests.some((request) =>
                    [request.link.source, request.link.target].some(
                      (r) => noteKey(r) === noteKey(note),
                    ),
                  );
                  const anchor = selectedKey === noteKey(note);
                  return (
                    <div
                      key={noteKey(note)}
                      ref={(element) => {
                        if (element) cards.current.set(noteKey(note), element);
                        else cards.current.delete(noteKey(note));
                      }}
                      className={`workflow-card${anchor ? ' is-selected' : ''}${related.has(noteKey(note)) ? ' is-related' : ''}${draft ? ' is-pending' : ''}`}
                    >
                      <button
                        type="button"
                        className="workflow-card-select"
                        aria-pressed={anchor}
                        aria-label={`选择 ${note.title}（${note.relativePath}）`}
                        disabled={saving}
                        onClick={() => selectNote(note)}
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
                      {anchor && <small className="workflow-card-state">当前笔记</small>}
                      {link && automaticKeys.has(linkKey(link)) && (
                        <small className="workflow-card-state">正文已有链接</small>
                      )}
                      {link && associationMode && (
                        <div className="workflow-card-actions">
                          {already ? (
                            <span className="workflow-card-state">已关联</span>
                          ) : (
                            <button
                              type="button"
                              disabled={blocked}
                              aria-label={`${actionLabel(role, stage.role)}：${note.title}（${note.relativePath}）`}
                              aria-pressed={draft}
                              onClick={(e) => choose(link, e.currentTarget)}
                            >
                              {draft ? '已选择 · 再点取消' : actionLabel(role, stage.role)}
                            </button>
                          )}
                        </div>
                      )}
                      {draft && <small className="workflow-card-state">待确认</small>}
                    </div>
                  );
                })}
                {!items.length && (
                  <p className="workspace-subtle">
                    {busy
                      ? '读取中…'
                      : !vault
                        ? '请先配置仓库角色'
                        : status && !status.online
                          ? '仓库离线'
                          : query || columnQueries[stage.role]
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
            <path
              key={line.key}
              d={line.path}
              className={`${line.reference ? 'is-reference ' : ''}${line.pending ? 'is-pending ' : ''}${line.automatic ? 'is-automatic ' : ''}${line.direct ? 'is-direct' : ''}`}
            />
          ))}
        </svg>
      </div>
      <aside className="workflow-inspector" aria-label="笔记关系">
        <h2>笔记关系</h2>
        {selected && (
          <div className="workflow-relation-counts">
            {groups
              .filter((group) => group.label !== '上下游链')
              .map((group) => (
                <span key={group.label}>
                  {group.label} {group.items.length}
                </span>
              ))}
          </div>
        )}
        {selected &&
          automatic.issues
            .filter(
              (issue) =>
                related.has(noteKey(issue.owner)) || noteKey(issue.owner) === noteKey(selected),
            )
            .map((issue, index) => (
              <p className="workspace-alert" key={index}>
                {issue.message}
              </p>
            ))}
        {selected ? (
          <>
            {!focused.length && (
              <p className="workspace-subtle">尚无已确认关联；相同标题不代表同一条流程。</p>
            )}
            <div className="workflow-relation-groups">
              {groups
                .filter((group) => group.items.length)
                .map((group) => (
                  <section key={group.label} aria-label={group.label + '关系'}>
                    <h3>
                      {group.label} · {group.items.length}
                    </h3>
                    <ul className="workflow-relations">
                      {group.items.map((link) => {
                        const source = byKey.get(noteKey(link.source)),
                          target = byKey.get(noteKey(link.target));
                        const isManual = store.links.some((l) => linkKey(l) === linkKey(link));
                        const isMetadata = (snapshot?.relations ?? []).some(
                          (l) => linkKey(l) === linkKey(link),
                        );
                        const display = (
                          r: WorkflowLink['source'],
                          note: WorkspaceNote | undefined,
                        ) =>
                          note ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => (cardVisible(note) ? locate(note) : onPreview(note))}
                            >
                              {note.title} · {cardVisible(note) ? '定位' : '预览（筛选外）'}
                            </button>
                          ) : (
                            <span>
                              {config.vaults.find((v) => v.id === r.vaultId)?.name ?? '未登记仓库'}{' '}
                              / {r.relativePath}（
                              {snapshot?.vaultStatuses.find((v) => v.vaultId === r.vaultId)
                                ?.online === false
                                ? '仓库离线'
                                : '断链或未索引'}
                              ）
                            </span>
                          );
                        return (
                          <li key={linkKey(link)}>
                            {display(link.source, source)}
                            <span>
                              {automaticKeys.has(linkKey(link)) && !isMetadata && !isManual
                                ? ' ⇢ 笔记链接 ⇢ '
                                : link.kind === 'origin'
                                  ? ' → 来源 → '
                                  : ' ⇢ 资料 ⇢ '}
                            </span>
                            {display(link.target, target)}
                            {roles.get(link.source.vaultId) === 'echo' &&
                              roles.get(link.target.vaultId) === 'output' && (
                                <small>直达输出</small>
                              )}
                            <small>
                              {[
                                isMetadata ? '笔记来源字段' : '',
                                isManual ? 'Hub 手动关联' : '',
                                automaticKeys.has(linkKey(link)) ? '正文跨库链接' : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                            {isManual && (
                              <button
                                type="button"
                                disabled={blocked || !!pending}
                                onClick={() =>
                                  void save({
                                    link,
                                    linked: false,
                                    sourceHash: source?.contentHash ?? '',
                                    targetHash: target?.contentHash ?? '',
                                  })
                                }
                              >
                                {isMetadata || automaticKeys.has(linkKey(link))
                                  ? '解除手动副本'
                                  : '解除手动关联'}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
            </div>
          </>
        ) : (
          <p className="workspace-subtle">选中任一笔记，查看来源、下游和参考资料。</p>
        )}
      </aside>
    </section>
  );
}
