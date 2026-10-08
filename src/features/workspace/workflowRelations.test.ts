import type { AppConfigV2 } from '../../domain/vault';
import type { WorkspaceSnapshot } from '../../domain/workspace';
import { describe, expect, it } from 'vitest';
import type { WorkflowLink } from '../../domain/workspace';
import type { VaultRole } from '../../domain/vault';
import { automaticLinks, confirmedLinks, focusedLinks, noteKey } from './workflowRelations';
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

describe('automatic workflow links', () => {
  const config = {
    vaults: [...roles.entries()].map(([id, role]) => ({
      id,
      role,
      name: { e: 'Echo', m: 'Main', o: 'Output', o2: 'Output', k: 'Knowledge' }[id],
    })),
  } as unknown as AppConfigV2;
  const snapshot = (owner: string, raw: string[]): WorkspaceSnapshot => ({
    notes: [],
    tasks: [],
    vaultStatuses: [],
    scannedAt: 1,
    fromCache: false,
    linkCandidates: [{ owner: ref(owner), raw, truncated: false }],
  });
  it('normalizes forward and reverse Echo-to-Output links with stable IDs and deduplicates headings', () => {
    expect(
      automaticLinks(snapshot('e', ['@renamed:o[[a.md#Heading]]', '@Output:o[[a|Alias]]']), config)
        .links,
    ).toEqual([link('e', 'o')]);
    expect(automaticLinks(snapshot('o', ['@Echo:e[[a.md]]']), config).links).toEqual([
      link('e', 'o'),
    ]);
  });
  it('supports multiple Echo sources and multiple Knowledge references', () => {
    const data = snapshot('m', ['@Echo:e[[a.md]]', '@Echo:e[[b.md]]']);
    expect(automaticLinks(data, config).links).toHaveLength(2);
    expect(
      automaticLinks(snapshot('o', ['@Knowledge:k[[a.md]]', '@Knowledge:k[[b.md]]']), config).links,
    ).toHaveLength(2);
  });
  it('reports ambiguous or missing vaults and rejects unsafe paths without guessing', () => {
    const result = automaticLinks(
      snapshot('e', ['@Output[[a.md]]', '@unknown:id[[a.md]]', '@Output:o[[C:/outside.md]]']),
      config,
    );
    expect(result.links).toEqual([]);
    expect(result.issues).toHaveLength(3);
  });
  it('does not expand sibling outputs through shared ancestors', () => {
    const edges = [link('e', 'm'), link('m', 'o'), link('m', 'o2')];
    expect(focusedLinks(ref('o'), edges, true)).toEqual(edges.slice(0, 2));
    expect(focusedLinks(ref('o'), edges, false)).toEqual([edges[1]]);
  });
});
