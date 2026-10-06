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
    ? (source === 'echo' && target === 'main') || (source === 'main' && target === 'output')
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
export function focusedLinks(selected: WorkflowNoteRef, links: WorkflowLink[]) {
  const ids = new Set([noteKey(selected)]);
  // References do not pull in unrelated outputs that happen to share a source.
  links
    .filter((l) => l.kind === 'reference' && noteKey(l.source) === noteKey(selected))
    .forEach((l) => ids.add(noteKey(l.target)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links.filter((l) => l.kind === 'origin')) {
      const source = noteKey(link.source),
        target = noteKey(link.target);
      if (ids.has(source) || ids.has(target)) {
        if (!ids.has(source) || !ids.has(target)) changed = true;
        ids.add(source);
        ids.add(target);
      }
    }
  }
  return links.filter((l) =>
    l.kind === 'origin'
      ? ids.has(noteKey(l.source)) && ids.has(noteKey(l.target))
      : ids.has(noteKey(l.target)) || noteKey(l.source) === noteKey(selected),
  );
}
