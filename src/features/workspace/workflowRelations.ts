import { parseCrossVaultLink } from '@obsidian-hub/cross-vault-parser';
import type { AppConfigV2 } from '../../domain/vault';
import type { WorkspaceSnapshot } from '../../domain/workspace';
import type { VaultRole } from '../../domain/vault';
import type { WorkflowLink, WorkflowNoteRef } from '../../domain/workspace';

export const noteKey = (note: WorkflowNoteRef) =>
  `${note.vaultId}:${note.relativePath.toLocaleLowerCase()}`;
export const linkKey = (link: WorkflowLink) =>
  `${link.kind}:${noteKey(link.source)}>${noteKey(link.target)}`;
export function allowedLink(link: WorkflowLink, roles: Map<string, VaultRole | null | undefined>) {
  const source = roles.get(link.source.vaultId);
  const target = roles.get(link.target.vaultId);
  return link.kind === 'origin'
    ? (source === 'echo' && (target === 'main' || target === 'output')) ||
        (source === 'main' && target === 'output')
    : source === 'knowledge' && target === 'output';
}
export function confirmedLinks(
  links: WorkflowLink[],
  roles: Map<string, VaultRole | null | undefined>,
) {
  return [
    ...new Map(
      links
        .filter((link) => {
          if (allowedLink(link, roles)) return true;
          // A removed vault must remain visible as a broken relationship.
          const sourceMissing = !roles.has(link.source.vaultId);
          const targetMissing = !roles.has(link.target.vaultId);
          const source = roles.get(link.source.vaultId),
            target = roles.get(link.target.vaultId);
          return link.kind === 'origin'
            ? (sourceMissing && (target === 'main' || target === 'output')) ||
                (targetMissing && (source === 'echo' || source === 'main'))
            : (sourceMissing && target === 'output') || (targetMissing && source === 'knowledge');
        })
        .map((link) => [linkKey(link), link]),
    ).values(),
  ];
}
export function focusedLinks(selected: WorkflowNoteRef, links: WorkflowLink[], expanded = true) {
  if (!expanded)
    return links.filter(
      (link) =>
        noteKey(link.source) === noteKey(selected) || noteKey(link.target) === noteKey(selected),
    );
  const anchors = new Set([noteKey(selected)]);
  links
    .filter((link) => link.kind === 'reference' && noteKey(link.source) === noteKey(selected))
    .forEach((link) => anchors.add(noteKey(link.target)));
  const upstream = new Set(anchors),
    downstream = new Set(anchors);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links.filter((link) => link.kind === 'origin')) {
      const source = noteKey(link.source),
        target = noteKey(link.target);
      if (upstream.has(target) && !upstream.has(source)) {
        upstream.add(source);
        changed = true;
      }
      if (downstream.has(source) && !downstream.has(target)) {
        downstream.add(target);
        changed = true;
      }
    }
  }
  const ids = new Set([...upstream, ...downstream]);
  return links.filter((link) =>
    link.kind === 'origin'
      ? upstream.has(noteKey(link.target)) || downstream.has(noteKey(link.source))
      : ids.has(noteKey(link.target)) || noteKey(link.source) === noteKey(selected),
  );
}

export function automaticLinks(snapshot: WorkspaceSnapshot | null, config: AppConfigV2) {
  const links = new Map<string, WorkflowLink>();
  const issues: Array<{ owner: WorkflowNoteRef; message: string }> = [];
  const roles = new Map(config.vaults.map((vault) => [vault.id, vault.role]));
  const normalize = (path: string) => path.replace(/\.md$/i, '').toLocaleLowerCase();
  const byPath = new Map<string, Array<{ relativePath: string }>>();
  for (const note of snapshot?.notes ?? []) {
    const key = `${note.vaultId}:${normalize(note.relativePath)}`;
    const list = byPath.get(key) ?? [];
    list.push(note);
    byPath.set(key, list);
  }
  for (const candidates of snapshot?.linkCandidates ?? []) {
    if (candidates.truncated)
      issues.push({ owner: candidates.owner, message: '链接数量或长度超出上限，部分链接未识别。' });
    for (const raw of candidates.raw) {
      const parsed = parseCrossVaultLink(raw);
      if (!parsed) continue;
      if (
        parsed.notePath.startsWith('/') ||
        /[:\0]/.test(parsed.notePath) ||
        parsed.notePath.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        issues.push({ owner: candidates.owner, message: '跨库链接路径无效。' });
        continue;
      }
      const vaults = config.vaults.filter((vault) =>
        parsed.vaultId
          ? vault.id === parsed.vaultId
          : vault.name.toLocaleLowerCase() === parsed.vaultName.toLocaleLowerCase(),
      );
      if (vaults.length !== 1) {
        issues.push({
          owner: candidates.owner,
          message: vaults.length
            ? '跨库仓库名存在歧义，请使用稳定仓库 ID。'
            : '跨库链接的仓库未登记。',
        });
        continue;
      }
      const matching = byPath.get(`${vaults[0].id}:${normalize(parsed.notePath)}`) ?? [];
      if (matching.length > 1) {
        issues.push({ owner: candidates.owner, message: '跨库笔记路径存在歧义。' });
        continue;
      }
      const target = {
        vaultId: vaults[0].id,
        relativePath:
          matching[0]?.relativePath ??
          (/\.md$/i.test(parsed.notePath) ? parsed.notePath : `${parsed.notePath}.md`),
      };
      for (const [source, destination] of [
        [candidates.owner, target],
        [target, candidates.owner],
      ]) {
        const link: WorkflowLink = {
          source,
          target: destination,
          kind: roles.get(source.vaultId) === 'knowledge' ? 'reference' : 'origin',
        };
        if (allowedLink(link, roles)) {
          links.set(linkKey(link), link);
          break;
        }
      }
    }
  }
  return { links: [...links.values()], issues };
}
