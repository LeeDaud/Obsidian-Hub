import { describe, expect, it } from 'vitest';
import type { WorkflowLink } from '../../domain/workspace';
import type { VaultRole } from '../../domain/vault';
import { confirmedLinks, focusedLinks, noteKey } from './workflowRelations';
const ref = (vaultId: string, relativePath = 'a.md') => ({ vaultId, relativePath });
const link = (
  source: string,
  target: string,
  kind: WorkflowLink['kind'] = 'origin',
): WorkflowLink => ({ source: ref(source), target: ref(target), kind });
const roles = new Map<string, VaultRole>([
  ['e', 'echo'],
  ['m', 'main'],
  ['o', 'output'],
  ['o2', 'output'],
  ['k', 'knowledge'],
]);
describe('workflow relationships', () => {
  it('retains broken references to removed vaults without permitting a new association', () => {
    const edge = link('removed', 'm');
    expect(confirmedLinks([edge], roles)).toEqual([edge]);
  });
  it('deduplicates case variants and rejects the wrong workflow roles', () => {
    const edge = link('e', 'm');
    expect(
      confirmedLinks(
        [edge, { ...edge, source: ref('e', 'A.md') }, link('k', 'm'), link('m', 'e')],
        roles,
      ),
    ).toEqual([expect.objectContaining({ target: ref('m') })]);
    expect(noteKey(ref('e', 'A.md'))).toBe(noteKey(ref('e')));
  });
  it('traces upstream and downstream without connecting unrelated outputs through shared references', () => {
    const edges = [
      link('e', 'm'),
      link('m', 'o'),
      link('k', 'o', 'reference'),
      link('k', 'o2', 'reference'),
    ];
    expect(focusedLinks(ref('m'), edges)).toEqual(edges.slice(0, 3));
    expect(focusedLinks(ref('o'), edges)).toEqual(edges.slice(0, 3));
    expect(focusedLinks(ref('k'), edges)).toEqual(edges);
  });
});
